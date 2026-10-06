import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {request} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'
import type {EngineToHost} from '../protocol/bridge'
import {BridgeServer} from './bridge-server'

let dir: string
let bridge: BridgeServer
let token: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'syncroom-bridge-'))
  await writeFile(join(dir, 'index.html'), '<script type="module" src="/engine.js?t=__TOKEN__"></script>')
  await writeFile(join(dir, 'engine.js'), 'console.log("engine")')
  bridge = await BridgeServer.start({pageDir: dir})
  token = new URL(bridge.pageUrl).searchParams.get('t') ?? ''
})

afterEach(async () => {
  await bridge.close()
  await rm(dir, {recursive: true, force: true})
})

interface Reply {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}

function http(path: string, options: {host?: string; method?: string} = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: bridge.port,
        path,
        method: options.method ?? 'GET',
        headers: {host: options.host ?? `127.0.0.1:${bridge.port}`}
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({status: res.statusCode ?? 0, body, headers: res.headers}))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function connect(path: string, origin = `http://127.0.0.1:${bridge.port}`): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}${path}`, {origin})
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

const nextMessage = (ws: WebSocket): Promise<string> =>
  new Promise(resolve => ws.once('message', data => resolve(String(data))))

const closed = (ws: WebSocket): Promise<void> => new Promise(resolve => ws.once('close', () => resolve()))

describe('BridgeServer http', () => {
  it('exposes a loopback url with a long random token', () => {
    expect(bridge.pageUrl).toBe(`http://127.0.0.1:${bridge.port}/?t=${token}`)
    expect(token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('serves the page with the token filled in and the required headers', async () => {
    const res = await http(`/?t=${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toBe(`<script type="module" src="/engine.js?t=${token}"></script>`)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(String(res.headers['content-security-policy'])).toContain("frame-src https://www.youtube.com")
  })

  it('serves the engine script', async () => {
    const res = await http(`/engine.js?t=${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toBe('console.log("engine")')
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
  })

  it('refuses requests without the right token', async () => {
    expect((await http('/')).status).toBe(403)
    expect((await http('/?t=nope')).status).toBe(403)
    const almost = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect((await http(`/engine.js?t=${almost}`)).status).toBe(403)
  })

  it('refuses a foreign Host header even with the token', async () => {
    expect((await http(`/?t=${token}`, {host: 'evil.example'})).status).toBe(403)
    expect((await http(`/?t=${token}`, {host: `localhost:${bridge.port}`})).status).toBe(403)
  })

  it('refuses other methods and unknown paths', async () => {
    expect((await http(`/?t=${token}`, {method: 'POST'})).status).toBe(403)
    expect((await http(`/secret.txt?t=${token}`)).status).toBe(404)
    expect((await http(`/../package.json?t=${token}`)).status).toBe(404)
  })

  it('stops listening after close', async () => {
    const other = await BridgeServer.start({pageDir: dir})
    const url = other.pageUrl
    await other.close()
    await expect(fetch(url)).rejects.toThrow()
  })
})

describe('BridgeServer websocket', () => {
  it('relays messages in both directions', async () => {
    const received: EngineToHost[] = []
    bridge.onMessage(m => received.push(m))
    const ws = await connect(`/ws?t=${token}`)
    const incoming = nextMessage(ws)
    bridge.send({t: 'leave'})
    expect(JSON.parse(await incoming)).toEqual({t: 'leave'})

    ws.send(JSON.stringify({t: 'ready'}))
    ws.send('this is not json')
    ws.send(JSON.stringify({t: 'net', directPeers: 1, relaysOk: 4}))
    await expect.poll(() => received.length).toBe(2)
    expect(received).toEqual([{t: 'ready'}, {t: 'net', directPeers: 1, relaysOk: 4}])
    ws.close()
  })

  it('stops delivering after unsubscribe', async () => {
    const received: EngineToHost[] = []
    const off = bridge.onMessage(m => received.push(m))
    const ws = await connect(`/ws?t=${token}`)
    off()
    ws.send(JSON.stringify({t: 'ready'}))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(received).toEqual([])
    ws.close()
  })

  it('drops messages sent while nobody is connected', () => {
    expect(() => bridge.send({t: 'leave'})).not.toThrow()
  })

  it('rejects connections without token, with a foreign origin or on another path', async () => {
    await expect(connect('/ws')).rejects.toThrow()
    await expect(connect('/ws?t=nope')).rejects.toThrow()
    await expect(connect(`/ws?t=${token}`, 'https://evil.example')).rejects.toThrow()
    await expect(connect(`/other?t=${token}`)).rejects.toThrow()
  })

  it('notifies when the client goes away, but not when it is replaced', async () => {
    const drops: number[] = []
    bridge.onDisconnect(() => drops.push(Date.now()))
    const first = await connect(`/ws?t=${token}`)
    const second = await connect(`/ws?t=${token}`)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(drops).toHaveLength(0)
    second.close()
    await expect.poll(() => drops.length).toBe(1)
    expect(first.readyState).not.toBe(first.OPEN)
  })

  it('a new connection replaces the previous one', async () => {
    const first = await connect(`/ws?t=${token}`)
    const firstClosed = closed(first)
    const second = await connect(`/ws?t=${token}`)
    await firstClosed
    const incoming = nextMessage(second)
    bridge.send({t: 'volume', value: 30})
    expect(JSON.parse(await incoming)).toEqual({t: 'volume', value: 30})
    second.close()
  })
})
