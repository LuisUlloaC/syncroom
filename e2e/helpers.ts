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

export interface TestPeer {
  session: RoomSession
  stop(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

export async function startPeer(options: {code: string; name: string; direct: boolean}): Promise<TestPeer> {
  const browser = await locateBrowser()
  if (browser === undefined) throw new Error('e2e needs Edge, Chrome, Brave or Chromium installed')
  const profileDir = await mkdtemp(join(tmpdir(), 'syncroom-e2e-'))
  const bridge = await BridgeServer.start({pageDir: resolve('dist/engine')})
  const engine = new EngineProcess(browser)
  const session = new RoomSession({
    code: options.code,
    peerId: generatePeerId(),
    name: options.name,
    direct: options.direct,
    relays: DEFAULT_RELAYS,
    volume: 0,
    link: bridge,
    resolve: async () => ({metas: [VIDEO], truncated: false})
  })
  session.start()
  // SYNCROOM_E2E_VISIBLE=1 abre la mini ventana para poder depurar con las DevTools.
  engine.start(buildEngineArgs({url: bridge.pageUrl, profileDir, visible: process.env.SYNCROOM_E2E_VISIBLE === '1'}))

  return {
    session,
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
