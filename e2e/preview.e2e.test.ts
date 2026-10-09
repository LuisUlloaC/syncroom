import {describe, expect, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import type {EngineToHost} from '../src/protocol/bridge'
import {startPeer, waitFor} from './helpers'

describe('preview', () => {
  it('captures the hidden player tab and offers it over WebRTC', async () => {
    const peer = await startPeer({code: generateRoomCode(), name: 'Solo', direct: false})
    const received: EngineToHost[] = []
    const unsubscribe = peer.bridge.onMessage(msg => {
      if (msg.t === 'preview' || msg.t === 'rtc') received.push(msg)
      if (msg.t === 'log') console.log(`engine: ${msg.text}`)
    })
    const states = () => received.flatMap(msg => (msg.t === 'preview' ? [msg] : []))
    const offers = () => received.flatMap(msg => (msg.t === 'rtc' && msg.signal.kind === 'offer' ? [msg.signal] : []))
    try {
      await waitFor('engine ready', () => peer.session.view().engineReady)
      // Con vídeo en marcha, como en una sala de verdad.
      await peer.session.addLink('ignored: the helper resolves a fixed video')
      await waitFor('video playing', () => peer.session.playerStatus()?.state === 'playing')

      peer.bridge.send({t: 'preview', on: true})
      await waitFor('capture on', () => states().some(msg => msg.state !== 'off'), 30_000)
      const on = states()[0]
      console.log(`preview state: ${JSON.stringify(on)}`)
      expect(on?.state).toBe('on')
      expect(on?.width ?? 0).toBeGreaterThan(0)
      expect(on?.height ?? 0).toBeGreaterThan(0)
      await waitFor('offer', () => offers().length > 0, 30_000)
      expect(offers()[0]?.sdp).toContain('m=video')

      peer.bridge.send({t: 'preview', on: false})
      await waitFor('capture off', () => states().some(msg => msg.state === 'off'), 10_000)
    } finally {
      unsubscribe()
      await peer.stop()
    }
  })
})
