import {describe, expect, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {startPeer, waitFor} from './helpers'

describe('engine', () => {
  it('plays a YouTube video in the hidden browser and obeys the session', async () => {
    const peer = await startPeer({code: generateRoomCode(), name: 'Solo', direct: false})
    const status = () => peer.session.playerStatus()
    try {
      await waitFor('engine ready', () => peer.session.view().engineReady)
      await peer.session.addLink('ignored: the helper resolves a fixed video')
      await waitFor('video playing', () => status()?.state === 'playing' && (status()?.timeS ?? 0) > 1)
      expect(status()?.durationS).toBeGreaterThan(120)

      peer.session.togglePlay()
      await waitFor('paused', () => status()?.state === 'paused', 20_000)

      peer.session.seek(120)
      peer.session.togglePlay()
      await waitFor('playing after the seek', () => status()?.state === 'playing' && (status()?.timeS ?? 0) > 119, 40_000)
    } finally {
      await peer.stop()
    }
  })
})
