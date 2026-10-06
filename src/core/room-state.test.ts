import {describe, expect, it, vi} from 'vitest'
import {MAX_QUEUE, RELAY_TRANSIT_MS, RoomState} from './room-state'
import {MAX_REMOVED, isRoomMessage} from './validate'
import type {Outgoing, VideoMeta} from './types'

const meta = (n: number): VideoMeta => ({
  videoId: `vid${String(n).padStart(8, '0')}`,
  title: `Song ${n}`,
  author: 'Artist'
})

interface Clock {
  t: number
}

function peer(id: string, clock: Clock): RoomState {
  return new RoomState({peerId: id, name: id.toUpperCase(), now: () => clock.t})
}

/** Entrega mensajes en ambos sentidos hasta que nadie tenga nada más que decir. */
function settle(a: RoomState, b: RoomState, toA: Outgoing[], toB: Outgoing[]): void {
  for (let round = 0; round < 20 && (toA.length > 0 || toB.length > 0); round++) {
    const fromA = toA.flatMap(o => a.receive(o.msg, 'direct'))
    const fromB = toB.flatMap(o => b.receive(o.msg, 'direct'))
    toA = fromB
    toB = fromA
  }
}

describe('queue', () => {
  it('adding to an empty room starts the first track', () => {
    const a = peer('a', {t: 1000})
    const out = a.addTracks([meta(1), meta(2)])
    expect(a.queue().map(t => t.videoId)).toEqual([meta(1).videoId, meta(2).videoId])
    expect(a.currentTrack()?.videoId).toBe(meta(1).videoId)
    expect(a.getPlayback().playing).toBe(true)
    expect(out.map(o => o.msg.type)).toEqual(['add', 'playback'])
    expect(out.every(o => o.relay)).toBe(true)
  })

  it('adding while something plays does not touch playback', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1)])
    const stamp = a.getPlayback().stamp
    const out = a.addTracks([meta(2)])
    expect(out.map(o => o.msg.type)).toEqual(['add'])
    expect(a.getPlayback().stamp).toEqual(stamp)
    expect(a.queue()).toHaveLength(2)
  })

  it('records who added each track', () => {
    const a = peer('ana', {t: 1000})
    a.addTracks([meta(1)])
    expect(a.queue()[0]?.addedBy).toBe('ANA')
  })

  it('removing the current track moves on to the next one', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2)])
    const current = a.currentTrack()
    expect(current).toBeDefined()
    const out = a.removeTrack(current?.id ?? '')
    expect(out.map(o => o.msg.type)).toEqual(['remove', 'playback'])
    expect(a.currentTrack()?.videoId).toBe(meta(2).videoId)
    expect(a.getPlayback().playing).toBe(true)
    expect(a.queue()).toHaveLength(1)
  })

  it('removing the only track stops playback', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1)])
    a.removeTrack(a.queue()[0]?.id ?? '')
    expect(a.getPlayback().trackId).toBeNull()
    expect(a.getPlayback().playing).toBe(false)
  })

  it('removing or playing an unknown track does nothing', () => {
    const a = peer('a', {t: 1000})
    expect(a.removeTrack('nope')).toEqual([])
    expect(a.playTrack('nope')).toEqual([])
  })

  it('queue is capped', () => {
    const a = peer('a', {t: 1000})
    a.addTracks(Array.from({length: MAX_QUEUE + 100}, (_, i) => meta(i)))
    expect(a.queue()).toHaveLength(MAX_QUEUE)
    expect(a.addTracks([meta(9999)])).toEqual([])

    // Tampoco crece con pistas que llegan de la red.
    const b = peer('b', {t: 1000})
    b.addTracks(Array.from({length: MAX_QUEUE}, (_, i) => meta(i)))
    for (const o of peer('c', {t: 1}).addTracks([meta(1), meta(2)])) b.receive(o.msg, 'relay')
    expect(b.queue()).toHaveLength(MAX_QUEUE)
  })
})

describe('playback', () => {
  it('pause keeps the position reached so far', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    a.addTracks([meta(1)])
    clock.t += 30_000
    a.setPlaying(false)
    expect(a.getPlayback().playing).toBe(false)
    clock.t += 60_000
    expect(a.expectedPosition()).toBeCloseTo(30, 3)
    a.setPlaying(true)
    clock.t += 5000
    expect(a.expectedPosition()).toBeCloseTo(35, 3)
  })

  it('seek never goes below zero and does nothing without a track', () => {
    const a = peer('a', {t: 1000})
    expect(a.seek(10)).toEqual([])
    a.addTracks([meta(1)])
    a.seek(-5)
    expect(a.getPlayback().positionS).toBe(0)
  })

  it('play with nothing selected starts the first track', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1)])
    a.trackEnded(a.queue()[0]?.id ?? '')
    expect(a.getPlayback().trackId).toBeNull()
    a.setPlaying(true)
    expect(a.currentTrack()?.videoId).toBe(meta(1).videoId)
    expect(a.getPlayback().playing).toBe(true)
  })

  it('trackEnded ignores a stale track and stops at the end of the queue', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2)])
    const [first, second] = a.queue()
    a.trackEnded(first?.id ?? '')
    expect(a.currentTrack()?.id).toBe(second?.id)
    expect(a.trackEnded(first?.id ?? '')).toEqual([])
    expect(a.currentTrack()?.id).toBe(second?.id)
    a.trackEnded(second?.id ?? '')
    expect(a.getPlayback().trackId).toBeNull()
    expect(a.getPlayback().playing).toBe(false)
  })

  it('playback age and transit are independent of wall clocks', () => {
    const ca = {t: 1_000_000}
    const cb = {t: 9_000_000_000}
    const a = peer('a', ca)
    const b = peer('b', cb)
    settle(a, b, [], a.addTracks([meta(1)]))
    expect(b.expectedPosition()).toBeCloseTo(0.05, 2)
    ca.t += 4000
    cb.t += 4000
    expect(a.expectedPosition()).toBeCloseTo(4, 2)
    expect(b.expectedPosition()).toBeCloseTo(4.05, 2)

    const c = peer('c', {t: 5})
    const hello = c.join()[0]
    expect(hello).toBeDefined()
    const reply = hello ? a.receive(hello.msg, 'relay') : []
    expect(reply.map(o => o.msg.type)).toEqual(['state'])
    for (const o of reply) c.receive(o.msg, 'relay')
    expect(c.queue()).toHaveLength(1)
    expect(c.expectedPosition()).toBeCloseTo(4 + RELAY_TRANSIT_MS / 1000, 2)
  })

  it('ping/pong measures the latency used for direct playback', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.join())
    const pings = a.pings()
    expect(pings).toHaveLength(1)
    expect(pings[0]?.relay).toBe(false)
    const pongs = pings.flatMap(o => b.receive(o.msg, 'direct'))
    expect(pongs.map(o => o.msg.type)).toEqual(['pong'])
    clock.t += 200
    for (const o of pongs) a.receive(o.msg, 'direct')
    for (const o of b.addTracks([meta(1)])) a.receive(o.msg, 'direct')
    expect(a.expectedPosition()).toBeCloseTo(0.1, 3)
  })
})

describe('convergence', () => {
  it('replicas converge with reordered and duplicated messages', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    const fromA = [...a.addTracks([meta(1), meta(2), meta(3)])]
    const fromB = [...b.addTracks([meta(4), meta(5)])]
    fromA.push(...a.removeTrack(a.queue()[1]?.id ?? ''))
    fromB.push(...b.seek(42))
    fromA.push(...a.setPlaying(false))

    settle(a, b, [...fromB, ...fromB].reverse(), [...fromA, ...fromA].reverse())
    clock.t += 5000
    settle(a, b, b.heartbeat(false), a.heartbeat(false))

    expect(a.digest()).toBe(b.digest())
    expect(a.queue().map(t => t.id)).toEqual(b.queue().map(t => t.id))
    expect(a.queue()).toHaveLength(4)
    expect(a.getPlayback().stamp).toEqual(b.getPlayback().stamp)
    expect(a.getPlayback().trackId).toBe(b.getPlayback().trackId)
    expect(a.getPlayback().playing).toBe(b.getPlayback().playing)
  })

  it('a removal wins over a late add of the same track', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    const out = [...a.addTracks([meta(1)])]
    out.push(...a.removeTrack(a.queue()[0]?.id ?? ''))
    for (const o of [...out].reverse()) b.receive(o.msg, 'relay')
    expect(b.queue()).toHaveLength(0)
    expect(b.currentTrack()).toBeUndefined()
  })

  it('concurrent playback writes resolve to the same winner on both sides', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, [], a.addTracks([meta(1)]))
    const seekA = a.seek(10)
    const seekB = b.seek(99)
    settle(a, b, seekB, seekA)
    expect(a.getPlayback().stamp).toEqual(b.getPlayback().stamp)
    expect(a.getPlayback().positionS).toBe(99)
    expect(b.getPlayback().positionS).toBe(99)
  })

  it('heals when the current track was removed by someone else', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, [], a.addTracks([meta(1), meta(2)]))
    const first = a.queue()[0]?.id ?? ''
    // b borra la primera sin que fuera su pista actual todavía conocida como tal por a
    const removal = b.removeTrack(first)
    const replay = a.playTrack(first)
    settle(a, b, removal, replay)
    clock.t += 5000
    settle(a, b, b.heartbeat(false), a.heartbeat(false))
    expect(a.currentTrack()?.videoId).toBe(meta(2).videoId)
    expect(b.currentTrack()?.videoId).toBe(meta(2).videoId)
  })

  it('a digest mismatch triggers a rate-limited state reply', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.join())
    a.addTracks([meta(1)]) // estos mensajes se pierden
    clock.t += 3000
    const reply = b.heartbeat(false).flatMap(o => a.receive(o.msg, 'direct'))
    expect(reply.map(o => o.msg.type)).toEqual(['state'])
    const again = b.heartbeat(false).flatMap(o => a.receive(o.msg, 'direct'))
    expect(again).toEqual([])
    for (const o of reply) b.receive(o.msg, 'direct')
    expect(b.digest()).toBe(a.digest())
    expect(b.queue()).toHaveLength(1)
  })
})

describe('hostile input', () => {
  it('keeps only the known fields of incoming tracks and playback', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const junk = 'x'.repeat(1000)
    const track = {id: 'z:1', videoId: meta(1).videoId, title: 'T', author: 'A', addedBy: 'Z', order: {counter: 1, peerId: 'z', junk}, junk}
    a.receive({type: 'add', from: 'z', tracks: [track]} as never, 'relay')
    a.receive({type: 'playback', from: 'z', playback: {trackId: 'z:1', playing: true, positionS: 0, ageMs: 0, stamp: {counter: 2, peerId: 'z', junk}, junk}} as never, 'relay')
    const state = JSON.stringify(a.receive({type: 'hello', from: 'b', name: 'B', digest: 'nope'}, 'relay'))
    expect(state).not.toContain(junk)
    expect(Object.keys(a.queue()[0] ?? {}).sort()).toEqual(['addedBy', 'author', 'id', 'order', 'title', 'videoId'])
  })

  it('caps tombstones for tracks it never saw, so its own state stays valid', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    for (let i = 0; i < MAX_REMOVED + 500; i++) a.receive({type: 'remove', from: 'z', trackId: `ghost:${i}`}, 'relay')
    a.addTracks([meta(1)])
    const known = a.queue()[0]?.id ?? ''
    a.receive({type: 'remove', from: 'z', trackId: known}, 'relay')
    expect(a.queue()).toHaveLength(0)
    const [reply] = a.receive({type: 'hello', from: 'b', name: 'B', digest: 'nope'}, 'relay')
    expect(reply?.msg.type).toBe('state')
    expect(isRoomMessage(reply?.msg)).toBe(true)
  })
})

describe('presence', () => {
  it('lists self first, learns names, expires and handles bye', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.join())
    expect(a.peerList()).toEqual([
      {id: 'a', name: 'A'},
      {id: 'b', name: 'B'}
    ])
    clock.t += 40_000
    a.expirePeers(35_000)
    expect(a.peerList()).toEqual([{id: 'a', name: 'A'}])

    settle(a, b, b.join(), [])
    expect(a.peerList()).toHaveLength(2)
    for (const o of b.leave()) a.receive(o.msg, 'relay')
    expect(a.peerList()).toHaveLength(1)
  })

  it('ignores its own messages', () => {
    const a = peer('a', {t: 1000})
    const hello = a.join()[0]
    expect(hello ? a.receive(hello.msg, 'relay') : ['x']).toEqual([])
    expect(a.peerList()).toHaveLength(1)
  })

  it('only answers pings addressed to it', () => {
    const a = peer('a', {t: 1000})
    expect(a.receive({type: 'ping', from: 'b', to: 'z', t0: 1}, 'direct')).toEqual([])
    expect(a.receive({type: 'ping', from: 'b', to: 'a', t0: 1}, 'direct')).toEqual([
      {msg: {type: 'pong', from: 'a', to: 'b', t0: 1}, relay: false}
    ])
  })

  it('notifies listeners on change and stops after unsubscribe', () => {
    const a = peer('a', {t: 1000})
    const listener = vi.fn()
    const off = a.onChange(listener)
    a.addTracks([meta(1)])
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    off()
    a.setPlaying(false)
    expect(listener).not.toHaveBeenCalled()
  })
})
