import {describe, expect, it} from 'vitest'
import {RoomState} from './room-state'
import {isRoomMessage} from './validate'
import type {VideoMeta} from './types'

const meta: VideoMeta = {videoId: 'M7lc1UVf-VE', title: 'A song', author: 'Someone'}
const stamp = {counter: 1, peerId: 'a'}
const track = {id: 'a:1', videoId: 'M7lc1UVf-VE', title: 'A song', author: 'Someone', addedBy: 'Ana', order: stamp}
const wire = {trackId: 'a:1', playing: true, positionS: 3, ageMs: 10, stamp}

describe('isRoomMessage', () => {
  it('accepts every message a real RoomState produces', () => {
    const clock = {t: 1000}
    const a = new RoomState({peerId: 'a', name: 'Ana', now: () => clock.t})
    const b = new RoomState({peerId: 'b', name: 'Leo', now: () => clock.t})
    const produced = [
      ...a.join(),
      ...a.addTracks([meta]),
      ...a.seek(5),
      ...a.removeTrack(a.queue()[0]?.id ?? ''),
      ...a.leave(),
      ...b.join().flatMap(o => a.receive(o.msg, 'relay')),
      ...a.pings(),
      ...a.pings().flatMap(o => b.receive(o.msg, 'direct'))
    ]
    expect(produced.length).toBeGreaterThan(6)
    for (const o of produced) expect(isRoomMessage(o.msg)).toBe(true)
    expect(isRoomMessage(JSON.parse(JSON.stringify(produced[0]?.msg)))).toBe(true)
  })

  it('accepts playback with no track', () => {
    expect(isRoomMessage({type: 'playback', from: 'a', playback: {...wire, trackId: null}})).toBe(true)
  })

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an array', []],
    ['unknown type', {type: 'nuke', from: 'a'}],
    ['missing from', {type: 'bye'}],
    ['empty from', {type: 'bye', from: ''}],
    ['from too long', {type: 'bye', from: 'x'.repeat(65)}],
    ['hello without digest', {type: 'hello', from: 'a', name: 'Ana'}],
    ['name too long', {type: 'hello', from: 'a', name: 'x'.repeat(41), digest: 'abc'}],
    ['add with bad video id', {type: 'add', from: 'a', tracks: [{...track, videoId: '../etc/passwd'}]}],
    ['add with huge title', {type: 'add', from: 'a', tracks: [{...track, title: 'x'.repeat(301)}]}],
    ['add with too many tracks', {type: 'add', from: 'a', tracks: Array.from({length: 501}, () => track)}],
    ['add with non-array tracks', {type: 'add', from: 'a', tracks: 'nope'}],
    ['track with an absurd counter', {type: 'add', from: 'a', tracks: [{...track, order: {counter: 2 ** 41, peerId: 'a'}}]}],
    ['playback with an absurd counter', {type: 'playback', from: 'a', playback: {...wire, stamp: {counter: Number.MAX_SAFE_INTEGER, peerId: 'a'}}}],
    ['track with float counter', {type: 'add', from: 'a', tracks: [{...track, order: {counter: 1.5, peerId: 'a'}}]}],
    ['track with negative counter', {type: 'add', from: 'a', tracks: [{...track, order: {counter: -1, peerId: 'a'}}]}],
    ['remove without id', {type: 'remove', from: 'a'}],
    ['playback with NaN position', {type: 'playback', from: 'a', playback: {...wire, positionS: Number.NaN}}],
    ['playback with negative position', {type: 'playback', from: 'a', playback: {...wire, positionS: -1}}],
    ['playback with negative age', {type: 'playback', from: 'a', playback: {...wire, ageMs: -1}}],
    ['playback with absurd age', {type: 'playback', from: 'a', playback: {...wire, ageMs: 1e12}}],
    ['playback with string playing', {type: 'playback', from: 'a', playback: {...wire, playing: 'yes'}}],
    ['state with bad removed', {type: 'state', from: 'a', name: 'Ana', tracks: [], removed: [1], playback: wire}],
    ['state with too many removed', {type: 'state', from: 'a', name: 'Ana', tracks: [], removed: Array.from({length: 5001}, () => 'x'), playback: wire}],
    ['ping with string t0', {type: 'ping', from: 'a', to: 'b', t0: 'now'}],
    ['pong without to', {type: 'pong', from: 'a', t0: 1}]
  ])('rejects %s', (_label, value) => {
    expect(isRoomMessage(value)).toBe(false)
  })
})
