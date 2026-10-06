import {describe, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {startPeer, waitFor} from './helpers'

describe('player window', () => {
  // Chromium no empieza a reproducir en una ventana que nace tapada o fuera de la vista.
  // Abrirla fuera de pantalla reproduce ese caso de forma determinista.
  it('starts playing even when the window opens out of sight', async () => {
    const peer = await startPeer({
      code: generateRoomCode(),
      name: 'Solo',
      direct: false,
      visible: true,
      extraArgs: ['--window-position=-9000,-9000']
    })
    const status = () => peer.session.playerStatus()
    try {
      await waitFor('engine ready', () => peer.session.view().engineReady)
      await peer.session.addLink('ignored: the helper resolves a fixed video')
      await waitFor('video playing in a window nobody can see', () => status()?.state === 'playing' && (status()?.timeS ?? 0) > 1, 30_000)
    } finally {
      await peer.stop()
    }
  })
})
