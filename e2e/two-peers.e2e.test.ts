import {describe, expect, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {SECOND_VIDEO, VIDEO, sleep, startPeer, waitFor} from './helpers'

describe.each([
  ['direct connection with relay backup', true],
  ['relays only', false]
])('two peers, %s', (_label, direct) => {
  it('share the queue, stay in sync and pause together', async () => {
    const code = generateRoomCode()
    const a = await startPeer({code, name: 'Ana', direct, videos: [VIDEO, SECOND_VIDEO, VIDEO]})
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

      await a.session.addLink('ignored: the helper resolves three fixed videos')
      await waitFor('the tracks reach the other peer', () => b.session.view().tracks.length === 3, 40_000)

      // b pone la tercera «a continuación» y a lo ve en el mismo orden.
      const third = b.session.view().tracks[2]?.id ?? ''
      b.session.playNext(third)
      const order = (peer: typeof a): string[] => peer.session.view().tracks.map(t => t.id)
      expect(order(b)[1]).toBe(third)
      await waitFor('a sees the new order', () => order(a)[1] === third, 30_000)
      expect(order(a)).toEqual(order(b))

      // Chat en los dos sentidos, con las líneas de entrada.
      b.session.say('hola desde Leo')
      await waitFor('a receives the chat', () => a.session.view().chat.some(l => l.kind === 'message' && l.text === 'hola desde Leo'), 30_000)
      a.session.say('hola Leo')
      await waitFor('b receives the chat', () => b.session.view().chat.some(l => l.kind === 'message' && l.text === 'hola Leo'), 30_000)
      // Leo entró durante el margen de entrada de Ana («ya estaba») o después («entró»): una de las dos líneas.
      await waitFor('a lists Leo as present or joined', () => a.session.view().chat.some(l => l.kind === 'present' || l.kind === 'joined'), 20_000)
      expect(a.session.view().chat.find(l => l.text === 'hola desde Leo')?.name).toBe('Leo')

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
