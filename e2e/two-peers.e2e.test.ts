import {describe, expect, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {sleep, startPeer, waitFor} from './helpers'

describe.each([
  ['direct connection with relay backup', true],
  ['relays only', false]
])('two peers, %s', (_label, direct) => {
  it('share the queue, stay in sync and pause together', async () => {
    const code = generateRoomCode()
    const a = await startPeer({code, name: 'Ana', direct})
    const b = await startPeer({code, name: 'Leo', direct})
    const timeOf = (peer: typeof a): number => peer.session.playerStatus()?.timeS ?? -100
    const stateOf = (peer: typeof a): string | undefined => peer.session.playerStatus()?.state
    try {
      await waitFor('both engines ready', () => a.session.view().engineReady && b.session.view().engineReady)
      await waitFor(
        'peers see each other',
        () => a.session.view().peers.length === 2 && b.session.view().peers.length === 2,
        120_000
      )
      expect(a.session.view().peers.map(peer => peer.name).sort()).toEqual(['Ana', 'Leo'])

      await a.session.addLink('ignored: the helper resolves a fixed video')
      await waitFor('the track reaches the other peer', () => b.session.view().tracks.length === 1, 40_000)
      await waitFor('both are playing', () => stateOf(a) === 'playing' && stateOf(b) === 'playing', 60_000)

      // Tiempo para que actúe la corrección de deriva (cada 5 s).
      await sleep(12_000)
      // Los dos estados se muestrean con hasta 1 s de diferencia, de ahí el margen.
      expect(Math.abs(timeOf(a) - timeOf(b))).toBeLessThan(2.5)

      b.session.togglePlay()
      await waitFor('a pauses when b pauses', () => stateOf(a) === 'paused', 30_000)
      expect(a.session.view().playback.playing).toBe(false)
    } finally {
      await Promise.all([a.stop(), b.stop()])
    }
  })
})
