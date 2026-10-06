import {randomBytes, timingSafeEqual} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {join} from 'node:path'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'
import type {EngineLink, EngineToHost, HostToEngine} from '../protocol/bridge'

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "connect-src 'self' ws://127.0.0.1:* wss:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:"
].join('; ')

export interface BridgeOptions {
  /** Carpeta con `index.html` y `engine.js` (en producción, `dist/engine`). */
  pageDir: string
}

export class BridgeServer implements EngineLink {
  private socket: WebSocket | undefined
  private readonly listeners = new Set<(msg: EngineToHost) => void>()

  private constructor(
    private readonly http: Server,
    private readonly wss: WebSocketServer,
    readonly port: number,
    private readonly token: string,
    private readonly pageDir: string
  ) {}

  static async start(options: BridgeOptions): Promise<BridgeServer> {
    const http = createServer()
    const wss = new WebSocketServer({noServer: true, maxPayload: 1024 * 1024})
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      // Solo loopback: nunca 0.0.0.0 ni «localhost».
      http.listen(0, '127.0.0.1', () => resolve())
    })
    const address = http.address()
    if (address === null || typeof address === 'string') {
      http.close()
      throw new Error('bridge server has no port')
    }
    const server = new BridgeServer(http, wss, address.port, randomBytes(24).toString('hex'), options.pageDir)
    http.on('request', (req, res) => void server.handleRequest(req, res))
    http.on('upgrade', (req, socket, head) => server.handleUpgrade(req, socket, head))
    return server
  }

  get pageUrl(): string {
    return `http://127.0.0.1:${this.port}/?t=${this.token}`
  }

  send(msg: HostToEngine): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg))
  }

  onMessage(listener: (msg: EngineToHost) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async close(): Promise<void> {
    this.socket?.terminate()
    this.socket = undefined
    this.wss.close()
    this.http.closeAllConnections()
    await new Promise<void>(resolve => this.http.close(() => resolve()))
  }

  private get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private parse(req: IncomingMessage): URL | undefined {
    try {
      return new URL(req.url ?? '/', this.origin)
    } catch {
      return undefined
    }
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    if (req.headers.host !== `127.0.0.1:${this.port}`) return false
    const given = Buffer.from(url.searchParams.get('t') ?? '')
    const expected = Buffer.from(this.token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  private reply(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // YouTube necesita el referer del origen; sin él devuelve el error 153.
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': CSP
    })
    res.end(body)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = this.parse(req)
    if (url === undefined || req.method !== 'GET' || !this.authorized(req, url)) {
      this.reply(res, 403, 'text/plain; charset=utf-8', 'forbidden')
      return
    }
    try {
      if (url.pathname === '/') {
        const html = await readFile(join(this.pageDir, 'index.html'), 'utf8')
        this.reply(res, 200, 'text/html; charset=utf-8', html.replaceAll('__TOKEN__', this.token))
        return
      }
      if (url.pathname === '/engine.js') {
        this.reply(res, 200, 'text/javascript; charset=utf-8', await readFile(join(this.pageDir, 'engine.js')))
        return
      }
    } catch {
      this.reply(res, 500, 'text/plain; charset=utf-8', 'engine page is missing; run the build')
      return
    }
    this.reply(res, 404, 'text/plain; charset=utf-8', 'not found')
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = this.parse(req)
    const allowed =
      url !== undefined && url.pathname === '/ws' && this.authorized(req, url) && req.headers.origin === this.origin
    if (!allowed) {
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, ws => this.attach(ws))
  }

  private attach(ws: WebSocket): void {
    this.socket?.close()
    this.socket = ws
    ws.on('message', data => {
      let msg: EngineToHost
      try {
        msg = JSON.parse(String(data)) as EngineToHost
      } catch {
        return
      }
      for (const listener of this.listeners) listener(msg)
    })
    ws.on('close', () => {
      if (this.socket === ws) this.socket = undefined
    })
    ws.on('error', () => ws.terminate())
  }
}
