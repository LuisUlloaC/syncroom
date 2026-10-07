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

function peer(id: string, clock: Clock, ownerKey = `key-${id}`): RoomState {
  return new RoomState({peerId: id, name: id.toUpperCase(), ownerKey, now: () => clock.t})
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

  it('adding to an empty room can start at a later track', () => {
    const a = peer('a', {t: 1000})
    const out = a.addTracks([meta(1), meta(2), meta(3)], 1)
    expect(a.currentTrack()?.videoId).toBe(meta(2).videoId)
    expect(out.map(o => o.msg.type)).toEqual(['add', 'playback'])
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

describe('reordering', () => {
  const ids = (s: RoomState): string[] => s.queue().map(t => t.videoId)

  it('new tracks get increasing ranks after the last one', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2)])
    a.addTracks([meta(3)])
    const ranks = a.queue().map(t => t.rank)
    expect(ranks).toEqual([...ranks].sort())
    expect(new Set(ranks).size).toBe(3)
    expect(ids(a)).toEqual([meta(1).videoId, meta(2).videoId, meta(3).videoId])
  })

  it('moves a track to the start, between two others and to the end', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2), meta(3)])
    const [t1, t2, t3] = a.queue().map(t => t.id) as [string, string, string]
    const out = a.moveTrack(t3, null, t1)
    expect(out.map(o => [o.msg.type, o.relay])).toEqual([['move', true]])
    expect(ids(a)).toEqual([meta(3).videoId, meta(1).videoId, meta(2).videoId])
    a.moveTrack(t3, t1, t2)
    expect(ids(a)).toEqual([meta(1).videoId, meta(3).videoId, meta(2).videoId])
    a.moveTrack(t1, t2, null)
    expect(ids(a)).toEqual([meta(3).videoId, meta(2).videoId, meta(1).videoId])
  })

  it('ignores moves of unknown, removed or self-neighbouring tracks and inverted neighbours', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2), meta(3)])
    const [t1, t2, t3] = a.queue().map(t => t.id) as [string, string, string]
    expect(a.moveTrack('nope', null, null)).toEqual([])
    expect(a.moveTrack(t2, t2, t3)).toEqual([])
    expect(a.moveTrack(t1, t3, t2)).toEqual([])
    a.removeTrack(t2)
    expect(a.moveTrack(t2, null, null)).toEqual([])
    expect(a.moveTrack(t3, null, t2)).toEqual([])
    expect(ids(a)).toEqual([meta(1).videoId, meta(3).videoId])
  })

  it('moving a track to where it already is does nothing', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2), meta(3)])
    const [t1, t2, t3] = a.queue().map(t => t.id) as [string, string, string]
    expect(a.moveTrack(t2, t1, t3)).toEqual([])
    expect(a.moveTrack(t1, null, t2)).toEqual([])
    expect(a.moveTrack(t3, t2, null)).toEqual([])
  })

  it('playNext puts a track right after the current one and next() honours it', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2), meta(3), meta(4)])
    const t4 = a.queue()[3]?.id ?? ''
    expect(a.playNext(t4).map(o => o.msg.type)).toEqual(['move'])
    expect(ids(a)).toEqual([meta(1).videoId, meta(4).videoId, meta(2).videoId, meta(3).videoId])
    // Ya es la siguiente, o es la actual: nada que hacer.
    expect(a.playNext(t4)).toEqual([])
    expect(a.playNext(a.currentTrack()?.id ?? '')).toEqual([])
    a.next()
    expect(a.currentTrack()?.videoId).toBe(meta(4).videoId)
  })

  it('playNext with nothing playing moves the track to the top', () => {
    const a = peer('a', {t: 1000})
    a.addTracks([meta(1), meta(2)])
    a.setPlaying(false)
    a.removeTrack(a.currentTrack()?.id ?? '')
    a.addTracks([meta(3)])
    // Ahora suena la 3 (se añadió con la sala parada); paramos del todo para probar el caso sin actual.
    const b = peer('b', {t: 1000})
    b.addTracks([meta(1), meta(2)])
    b.next()
    b.next()
    expect(b.currentTrack()).toBeUndefined()
    const t2 = b.queue()[1]?.id ?? ''
    b.playNext(t2)
    expect(ids(b)).toEqual([meta(2).videoId, meta(1).videoId])
  })

  it('concurrent moves of the same track converge on both peers', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.addTracks([meta(1), meta(2), meta(3)]))
    expect(ids(b)).toEqual(ids(a))
    const [t1, t2, t3] = a.queue().map(t => t.id) as [string, string, string]
    // a pone la 3 al principio; b, a la vez, la 3 en medio. Marcas distintas: gana una en los dos.
    const fromA = a.moveTrack(t3, null, t1)
    const fromB = b.moveTrack(t3, t1, t2)
    settle(a, b, fromB, fromA)
    expect(ids(a)).toEqual(ids(b))
    expect(ids(a)).toHaveLength(3)
  })

  it('a move for a track not yet known is ignored and the later state brings its rank', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    a.addTracks([meta(1), meta(2)])
    const t2 = a.queue()[1]?.id ?? ''
    const move = a.moveTrack(t2, null, a.queue()[0]?.id ?? null)
    expect(b.receive(move[0]?.msg ?? {type: 'bye', from: 'a'}, 'direct')).toEqual([])
    expect(b.queue()).toHaveLength(0)
    settle(a, b, b.join(), [])
    expect(ids(b)).toEqual(ids(a))
    expect(ids(b)[0]).toBe(meta(2).videoId)
  })

  it('a move that arrived before its add is repaired by the next heartbeat (digest covers ranks)', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    const c = peer('c', clock)
    const add = a.addTracks([meta(1), meta(2)])
    for (const o of add) b.receive(o.msg, 'direct')
    const [t1, t2] = a.queue().map(t => t.id) as [string, string]
    const move = b.moveTrack(t2, null, t1)
    for (const o of move) a.receive(o.msg, 'direct')
    // c recibe el move antes que el add: el move se ignora y c se queda con el orden viejo.
    for (const o of move) c.receive(o.msg, 'relay')
    for (const o of add) c.receive(o.msg, 'relay')
    expect(a.queue().map(t => t.id)).toEqual([t2, t1])
    expect(c.queue().map(t => t.id)).toEqual([t1, t2])
    expect(c.digest()).not.toBe(a.digest())
    // a ya conoce a c (por un ping); el siguiente latido de c trae una huella distinta y a responde con su state.
    a.receive({type: 'ping', from: 'c', to: 'a', t0: 1}, 'direct')
    clock.t += 10_000
    const reply = c.heartbeat(false).flatMap(o => a.receive(o.msg, 'direct'))
    expect(reply.map(o => o.msg.type)).toEqual(['state'])
    for (const o of reply) c.receive(o.msg, 'direct')
    expect(c.queue().map(t => t.id)).toEqual([t2, t1])
    expect(c.digest()).toBe(a.digest())
  })

  it('concurrent adds from different peers never tie on rank', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.join())
    const fromA = a.addTracks([meta(1)])
    const fromB = b.addTracks([meta(2)])
    settle(a, b, fromB, fromA)
    const ranks = a.queue().map(t => t.rank)
    expect(new Set(ranks).size).toBe(2)
    expect(a.queue().map(t => t.id)).toEqual(b.queue().map(t => t.id))
    // Y se puede soltar algo entre las dos.
    const [x, y] = a.queue().map(t => t.id) as [string, string]
    const out = a.addTracks([meta(3)])
    settle(a, b, [], out)
    const z = a.queue()[2]?.id ?? ''
    const move = a.moveTrack(z, x, y)
    expect(move).toHaveLength(1)
    settle(a, b, [], move)
    expect(a.queue().map(t => t.id)).toEqual([x, z, y])
    expect(b.queue().map(t => t.id)).toEqual([x, z, y])
  })

  it('dropping between two tracks that tie on rank still works (the second one is nudged)', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    a.addTracks([meta(1), meta(3)])
    const [t1, t3] = a.queue() as [import('./types').Track, import('./types').Track]
    // Una pista ajena con exactamente el mismo rank que t1 (puede pasar con participantes antiguos u hostiles).
    a.receive({type: 'add', from: 'z', tracks: [{...t1, id: 'z:1', videoId: meta(2).videoId, addedBy: 'Z', order: {counter: 1, peerId: 'z'}, moved: {counter: 1, peerId: 'z'}}]}, 'relay')
    expect(a.queue().map(t => t.id)).toEqual([t1.id, 'z:1', t3.id])
    const out = a.moveTrack(t3.id, t1.id, 'z:1')
    expect(out.map(o => o.msg.type)).toEqual(['move', 'move'])
    expect(a.queue().map(t => t.id)).toEqual([t1.id, t3.id, 'z:1'])
    expect(new Set(a.queue().map(t => t.rank)).size).toBe(3)
  })

  it('a newcomer sees the moved order through state', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    a.addTracks([meta(1), meta(2), meta(3)])
    a.moveTrack(a.queue()[2]?.id ?? '', null, a.queue()[0]?.id ?? null)
    const c = peer('c', clock)
    settle(a, c, c.join(), [])
    expect(ids(c)).toEqual(ids(a))
    expect(ids(c)[0]).toBe(meta(3).videoId)
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
    const track = {id: 'z:1', videoId: meta(1).videoId, title: 'T', author: 'A', addedBy: 'Z', order: {counter: 1, peerId: 'z', junk}, rank: 'a0', moved: {counter: 1, peerId: 'z', junk}, junk}
    a.receive({type: 'add', from: 'z', tracks: [track]} as never, 'relay')
    a.receive({type: 'playback', from: 'z', playback: {trackId: 'z:1', playing: true, positionS: 0, ageMs: 0, stamp: {counter: 2, peerId: 'z', junk}, junk}} as never, 'relay')
    const state = JSON.stringify(a.receive({type: 'hello', from: 'b', name: 'B', digest: 'nope'}, 'relay'))
    expect(state).not.toContain(junk)
    expect(Object.keys(a.queue()[0] ?? {}).sort()).toEqual(['addedBy', 'author', 'id', 'moved', 'order', 'rank', 'title', 'videoId'])
    expect(Object.keys(a.queue()[0]?.moved ?? {}).sort()).toEqual(['counter', 'peerId'])
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

describe('renaming', () => {
  it('setName broadcasts a hello and the others adopt the new name', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    settle(a, b, b.join(), a.join())
    expect(b.peerList().map(p => p.name)).toEqual(['B', 'A'])
    const out = a.setName('Ana')
    expect(out.map(o => [o.msg.type, o.relay])).toEqual([['hello', true]])
    settle(a, b, [], out)
    expect(a.peerList()[0]?.name).toBe('Ana')
    expect(b.peerList().map(p => p.name)).toEqual(['B', 'Ana'])
    // Lo que se añada a partir de ahora lleva el nombre nuevo; lo anterior no cambia.
    a.addTracks([meta(1)])
    expect(a.queue()[0]?.addedBy).toBe('Ana')
  })
})

describe('room policy (owner and locks)', () => {
  const ids = (s: RoomState): string[] => s.queue().map(t => t.videoId)

  function ownedRoom() {
    const clock = {t: 1000}
    const a = peer('a', clock)
    const b = peer('b', clock)
    const claim = a.claimRoom()
    expect(claim.map(o => [o.msg.type, o.relay])).toEqual([['policy', true]])
    settle(a, b, b.join(), [...a.join(), ...claim])
    settle(a, b, [], a.addTracks([meta(1), meta(2), meta(3)]))
    return {clock, a, b}
  }

  it('the creator owns the room and newcomers learn it through state', () => {
    const {a, b} = ownedRoom()
    expect(a.isOwner()).toBe(true)
    expect(b.isOwner()).toBe(false)
    expect(b.getPolicy()).toMatchObject({ownerPeerId: 'a', ownerName: 'A', lockQueue: false, lockPlayback: false})
    expect(a.mayEditQueue()).toBe(true)
    expect(b.mayEditQueue()).toBe(true)
  })

  it('only the owner can change the locks, and everyone sees them', () => {
    const {a, b} = ownedRoom()
    expect(b.setLocks({lockQueue: true})).toEqual([])
    const out = a.setLocks({lockQueue: true})
    expect(out.map(o => o.msg.type)).toEqual(['policy'])
    settle(a, b, [], out)
    expect(b.getPolicy()?.lockQueue).toBe(true)
    expect(b.mayEditQueue()).toBe(false)
    expect(b.mayControlPlayback()).toBe(true)
    settle(a, b, [], a.setLocks({lockQueue: false, lockPlayback: true}))
    expect(b.getPolicy()).toMatchObject({lockQueue: false, lockPlayback: true})
  })

  it('a locked queue blocks the others locally and on the wire', () => {
    const {a, b} = ownedRoom()
    settle(a, b, [], a.setLocks({lockQueue: true}))
    const [t1, t2] = b.queue().map(t => t.id) as [string, string]
    expect(b.addTracks([meta(9)])).toEqual([])
    expect(b.removeTrack(t1)).toEqual([])
    expect(b.moveTrack(t2, null, t1)).toEqual([])
    expect(b.playNext(t2)).toEqual([])
    expect(ids(b)).toEqual(ids(a))
    // Un cliente alterado manda igualmente los mensajes: el dueño y el resto los ignoran.
    const z = peer('z', {t: 1000})
    for (const o of z.addTracks([meta(9)])) a.receive(o.msg, 'relay')
    a.receive({type: 'remove', from: 'z', trackId: t1}, 'relay')
    a.receive({type: 'move', from: 'z', trackId: t2, rank: 'Zz', moved: {counter: 99, peerId: 'z'}}, 'relay')
    expect(ids(a)).toEqual([meta(1).videoId, meta(2).videoId, meta(3).videoId])
    // El dueño sigue pudiendo.
    expect(a.removeTrack(t1).map(o => o.msg.type)).toEqual(['remove', 'playback'])
  })

  it('locked playback blocks play, pause, seek, skip and auto-advance for the others', () => {
    const {a, b} = ownedRoom()
    settle(a, b, [], a.setLocks({lockPlayback: true}))
    const t3 = b.queue()[2]?.id ?? ''
    expect(b.setPlaying(false)).toEqual([])
    expect(b.seek(30)).toEqual([])
    expect(b.next()).toEqual([])
    expect(b.playTrack(t3)).toEqual([])
    expect(b.trackEnded(b.currentTrack()?.id ?? '')).toEqual([])
    expect(b.getPlayback().playing).toBe(true)
    const before = a.getPlayback().stamp
    a.receive({type: 'playback', from: 'z', playback: {trackId: null, playing: false, positionS: 0, ageMs: 0, stamp: {counter: 99, peerId: 'z'}}}, 'relay')
    expect(a.getPlayback().stamp).toEqual(before)
    // La cola sigue abierta.
    expect(b.addTracks([meta(9)]).map(o => o.msg.type)).toEqual(['add'])
    // El dueño salta y todos lo siguen.
    settle(a, b, [], a.next())
    expect(b.currentTrack()?.videoId).toBe(meta(2).videoId)
  })

  it('locks are suspended while the owner is away, so the room never stalls', () => {
    const {clock, a, b} = ownedRoom()
    settle(a, b, [], a.setLocks({lockQueue: true, lockPlayback: true}))
    expect(b.mayEditQueue()).toBe(false)
    for (const o of a.leave()) b.receive(o.msg, 'relay')
    expect(b.mayEditQueue()).toBe(true)
    expect(b.mayControlPlayback()).toBe(true)
    expect(b.addTracks([meta(9)]).map(o => o.msg.type)).toEqual(['add'])
    // Vuelve (misma clave, otro peerId): recupera la sala y los bloqueos siguen en pie.
    const a2 = peer('a2', clock, 'key-a')
    const reply = a2.join().flatMap(o => b.receive(o.msg, 'direct'))
    expect(reply.map(o => o.msg.type)).toEqual(['state'])
    const reclaim = reply.flatMap(o => a2.receive(o.msg, 'direct'))
    expect(reclaim.map(o => o.msg.type)).toEqual(['policy'])
    expect(a2.isOwner()).toBe(true)
    for (const o of reclaim) b.receive(o.msg, 'direct')
    expect(b.getPolicy()).toMatchObject({ownerPeerId: 'a2', lockQueue: true, lockPlayback: true})
    expect(b.mayEditQueue()).toBe(false)
  })

  it('ignores a policy from someone who is not the owner', () => {
    const {a, b} = ownedRoom()
    const stamp = {counter: 500, peerId: 'z'}
    b.receive({type: 'policy', from: 'z', policy: {ownerKey: 'key-z', ownerPeerId: 'z', ownerName: 'Z', lockQueue: true, lockPlayback: true, stamp}}, 'relay')
    expect(b.getPolicy()?.ownerKey).toBe('key-a')
    expect(b.getPolicy()?.lockQueue).toBe(false)
    expect(a.getPolicy()?.ownerKey).toBe('key-a')
  })

  it('a room nobody claimed has no policy and no locks', () => {
    const clock = {t: 1000}
    const a = peer('a', clock)
    expect(a.getPolicy()).toBeUndefined()
    expect(a.isOwner()).toBe(false)
    expect(a.mayEditQueue()).toBe(true)
    expect(a.mayControlPlayback()).toBe(true)
  })

  it('a changed policy shows in the digest, so a lost policy message is repaired by the next state', () => {
    const {a, b} = ownedRoom()
    const before = b.digest()
    a.setLocks({lockQueue: true})
    expect(a.digest()).not.toBe(before)
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
