import {describe, expect, it} from 'vitest'
import {RoomState} from './room-state'
import {isRoomMessage} from './validate'
import type {VideoMeta} from './types'

const meta: VideoMeta = {videoId: 'M7lc1UVf-VE', title: 'A song', author: 'Someone'}
const stamp = {counter: 1, peerId: 'a'}
const track = {id: 'a:1', videoId: 'M7lc1UVf-VE', title: 'A song', author: 'Someone', addedBy: 'Ana', order: stamp, rank: 'a0', moved: stamp}
const wire = {trackId: 'a:1', playing: true, positionS: 3, ageMs: 10, stamp}

describe('isRoomMessage', () => {
  it('accepts every message a real RoomState produces', () => {
    const clock = {t: 1000}
    const a = new RoomState({peerId: 'a', name: 'Ana', ownerKey: 'ka', now: () => clock.t})
    const b = new RoomState({peerId: 'b', name: 'Leo', ownerKey: 'kb', now: () => clock.t})
    const produced = [
      ...a.join(),
      ...a.claimRoom(),
      ...a.setLocks({lockQueue: true}),
      ...a.addTracks([meta]),
      ...a.seek(5),
      ...a.addTracks([{...meta, videoId: 'bbbbbbbbbbb'}]),
      ...a.moveTrack(a.queue()[1]?.id ?? '', null, a.queue()[0]?.id ?? null),
      ...a.removeTrack(a.queue()[0]?.id ?? ''),
      a.chatMessage('hola'),
      ...a.leave(),
      ...b.join().flatMap(o => a.receive(o.msg, 'relay')),
      ...a.pings(),
      ...a.pings().flatMap(o => b.receive(o.msg, 'direct'))
    ]
    expect(produced.length).toBeGreaterThan(6)
    for (const o of produced) expect(isRoomMessage(o.msg)).toBe(true)
    expect(isRoomMessage(JSON.parse(JSON.stringify(produced[0]?.msg)))).toBe(true)
  })

  it.each(['a0', 'a0V', 'Zz', 'a1Xy', 'b00001'])('accepts rank %s', rank => {
    expect(isRoomMessage({type: 'move', from: 'a', trackId: 'a:1', rank, moved: {counter: 2, peerId: 'a'}})).toBe(true)
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
    ['chat without text', {type: 'chat', from: 'a', name: 'Ana', id: 'a:9'}],
    ['chat with empty text', {type: 'chat', from: 'a', name: 'Ana', id: 'a:9', text: ''}],
    ['chat with huge text', {type: 'chat', from: 'a', name: 'Ana', id: 'a:9', text: 'x'.repeat(501)}],
    ['chat without id', {type: 'chat', from: 'a', name: 'Ana', text: 'hi'}],
    ['chat with long name', {type: 'chat', from: 'a', name: 'x'.repeat(41), id: 'a:9', text: 'hi'}],
    ['track without rank', {type: 'add', from: 'a', tracks: [{...track, rank: undefined}]}],
    ['track with non-base62 rank', {type: 'add', from: 'a', tracks: [{...track, rank: 'a0/..'}]}],
    ['track with rank "zz" (bad integer part)', {type: 'add', from: 'a', tracks: [{...track, rank: 'zz'}]}],
    ['track with rank "a" (too short)', {type: 'add', from: 'a', tracks: [{...track, rank: 'a'}]}],
    ['track with rank "a00" (trailing zero)', {type: 'add', from: 'a', tracks: [{...track, rank: 'a00'}]}],
    ['track with rank "0"', {type: 'add', from: 'a', tracks: [{...track, rank: '0'}]}],
    ['move with rank "zz"', {type: 'move', from: 'a', trackId: 'a:1', rank: 'zz', moved: {counter: 2, peerId: 'a'}}],
    ['chat with only spaces', {type: 'chat', from: 'a', name: 'Ana', id: 'a:9', text: '   '}],
    ['policy without stamp', {type: 'policy', from: 'a', policy: {ownerKey: 'k', ownerPeerId: 'a', ownerName: 'A', lockQueue: false, lockPlayback: false}}],
    ['policy with string lock', {type: 'policy', from: 'a', policy: {ownerKey: 'k', ownerPeerId: 'a', ownerName: 'A', lockQueue: 'yes', lockPlayback: false, stamp}}],
    ['policy with empty owner key', {type: 'policy', from: 'a', policy: {ownerKey: '', ownerPeerId: 'a', ownerName: 'A', lockQueue: false, lockPlayback: false, stamp}}],
    ['policy with long owner name', {type: 'policy', from: 'a', policy: {ownerKey: 'k', ownerPeerId: 'a', ownerName: 'x'.repeat(41), lockQueue: false, lockPlayback: false, stamp}}],
    ['state with bad policy', {type: 'state', from: 'a', name: 'Ana', tracks: [], removed: [], playback: wire, policy: {ownerKey: 'k'}}],
    ['track with huge rank', {type: 'add', from: 'a', tracks: [{...track, rank: 'a'.repeat(257)}]}],
    ['move without rank', {type: 'move', from: 'a', trackId: 'a:1', moved: {counter: 2, peerId: 'a'}}],
    ['move with empty rank', {type: 'move', from: 'a', trackId: 'a:1', rank: '', moved: {counter: 2, peerId: 'a'}}],
    ['move with bad stamp', {type: 'move', from: 'a', trackId: 'a:1', rank: 'a1', moved: {counter: 'x', peerId: 'a'}}],
    ['move without trackId', {type: 'move', from: 'a', rank: 'a1', moved: {counter: 2, peerId: 'a'}}],
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
