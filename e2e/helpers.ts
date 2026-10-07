import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {generatePeerId} from '../src/core/ids'
import type {VideoMeta} from '../src/core/types'
import {BridgeServer} from '../src/host/bridge-server'
import {locateBrowser} from '../src/host/engine/browser-locator'
import {EngineProcess, buildEngineArgs} from '../src/host/engine/engine-process'
import {RoomSession} from '../src/host/session'
import {DEFAULT_RELAYS} from '../src/protocol/defaults'

/** Vídeo de demostración del propio API de YouTube: permite incrustarse y dura más de 3 minutos. */
export const VIDEO: VideoMeta = {
  videoId: 'M7lc1UVf-VE',
  title: 'Embedded Web Player Customization',
  author: 'Google for Developers'
}
/** Segundo vídeo incrustable (el primero subido a YouTube). */
export const SECOND_VIDEO: VideoMeta = {videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed'}

export interface TestPeer {
  session: RoomSession
  profileDir: string
  /** Órdenes enviadas al reproductor (load/play/pause/seek/stop) desde el arranque. */
  playerCommands: () => number
  stop(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

export interface PeerOptions {
  code: string
  name: string
  direct: boolean
  /** Por defecto oculto; SYNCROOM_E2E_VISIBLE=1 abre la mini ventana para depurar con las DevTools. */
  visible?: boolean
  extraArgs?: string[]
  /** Lo que devuelve cada addLink; por defecto, VIDEO. */
  videos?: VideoMeta[]
}

export async function startPeer(options: PeerOptions): Promise<TestPeer> {
  const browser = await locateBrowser()
  if (browser === undefined) throw new Error('e2e needs Edge, Chrome, Brave or Chromium installed')
  const profileDir = await mkdtemp(join(tmpdir(), 'syncroom-e2e-'))
  const bridge = await BridgeServer.start({pageDir: resolve('dist/engine')})
  const engine = new EngineProcess(browser)
  let playerCommands = 0
  const originalSend = bridge.send.bind(bridge)
  bridge.send = msg => {
    if (msg.t === 'player') playerCommands += 1
    originalSend(msg)
  }
  const session = new RoomSession({
    code: options.code,
    peerId: generatePeerId(),
    name: options.name,
    direct: options.direct,
    relays: DEFAULT_RELAYS,
    volume: 0,
    link: bridge,
    resolve: async () => ({metas: options.videos ?? [VIDEO], truncated: false, startIndex: 0})
  })
  session.start()
  const visible = options.visible ?? process.env.SYNCROOM_E2E_VISIBLE === '1'
  engine.start([...buildEngineArgs({url: bridge.pageUrl, profileDir, visible}), ...(options.extraArgs ?? [])])

  return {
    session,
    profileDir,
    playerCommands: () => playerCommands,
    async stop() {
      session.dispose()
      await sleep(300)
      await engine.stop()
      await bridge.close()
      await rm(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}).catch(() => undefined)
    }
  }
}

export async function waitFor(label: string, check: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

export {sleep}
