import {describe, expect, it, vi} from 'vitest'
import {ANNOUNCE_KIND, PUBLIC_SCOPE, PUBLIC_TAG, buildAnnouncement, buildTombstone, groupScope, type Announcement} from './announcement'
import {Directory, NOTIFY_MS, REFRESH_MS, SEARCH_TIMEOUT_MS, SINCE_S} from './directory'
import {deriveGroupKeys} from './group-key'
import {RoomList} from './room-list'
import {FakeClock, FakeNet, asEvent} from './testing'

const none = {rooms: [], owners: []}
const room: Announcement = {v: 1, code: 'ABCD2345', owner: 'Ana', playing: 'Song', listeners: 2, locks: {queue: false, playback: false}}

function setup() {
  const clock = new FakeClock()
  const net = new FakeNet()
  let changes = 0
  const directory = new Directory({net, clock, onChange: () => changes++})
  const nowS = () => Math.floor(clock.now() / 1000)
  return {clock, net, directory, nowS, changes: () => changes}
}

describe('Directory', () => {
  it('subscribes only while active, to the public tag and every group tag', async () => {
    const {net, directory, nowS} = setup()
    const group = groupScope(await deriveGroupKeys('motorflash-front'))
    directory.setScopes([PUBLIC_SCOPE, group])
    expect(net.openSubs()).toHaveLength(0)
    directory.setActive(true)
    expect(net.openSubs().map(s => s.filter)).toEqual([{kinds: [ANNOUNCE_KIND], '#t': [PUBLIC_TAG, group.tag], since: nowS() - SINCE_S}])
    directory.setActive(false)
    expect(net.openSubs()).toHaveLength(0)
  })

  it('searches until the relays finish sending, then lists what arrived', async () => {
    const {net, directory, nowS} = setup()
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    expect(directory.view(none).status).toBe('searching')
    net.emit(asEvent(await buildAnnouncement(PUBLIC_SCOPE, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).rooms.map(r => r.code)).toEqual(['ABCD2345']))
    net.subs[0]?.oneose()
    expect(directory.view(none).status).toBe('ok')
  })

  it('says offline when no relay connects within 5 seconds', () => {
    const {clock, net, directory} = setup()
    net.connectedRelays = 0
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    clock.advance(SEARCH_TIMEOUT_MS)
    expect(directory.view(none).status).toBe('offline')
  })

  it('a room that arrives turns offline into ok', async () => {
    const {clock, net, directory, nowS} = setup()
    net.connectedRelays = 0
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    clock.advance(SEARCH_TIMEOUT_MS)
    net.emit(asEvent(await buildAnnouncement(PUBLIC_SCOPE, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).status).toBe('ok'))
  })

  it('a tombstone removes the room and notifies', async () => {
    const {net, directory, nowS, changes} = setup()
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    net.emit(asEvent(await buildAnnouncement(PUBLIC_SCOPE, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).rooms).toHaveLength(1))
    const before = changes()
    net.emit(asEvent(await buildTombstone(PUBLIC_SCOPE, room.code, nowS() + 1)))
    await vi.waitFor(() => expect(directory.view(none).rooms).toHaveLength(0))
    expect(changes()).toBeGreaterThan(before)
  })

  it('changing the groups resubscribes and forgets rooms from the old subscription, even late ones', async () => {
    const {net, directory, nowS} = setup()
    const group = groupScope(await deriveGroupKeys('motorflash-front'))
    directory.setScopes([PUBLIC_SCOPE, group])
    directory.setActive(true)
    const old = net.subs[0]
    net.emit(asEvent(await buildAnnouncement(group, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).rooms).toHaveLength(1))
    const late = asEvent(await buildAnnouncement(group, {...room, code: 'ZZZZ2345'}, nowS()))
    directory.setScopes([PUBLIC_SCOPE])
    expect(old?.open).toBe(false)
    expect(net.openSubs()).toHaveLength(1)
    expect(directory.view(none).rooms).toHaveLength(0)
    old?.onevent(late)
    await new Promise(done => setTimeout(done, 50))
    expect(directory.view(none).rooms).toHaveLength(0)
  })

  it('re-checks every 15 seconds, so a room whose owner vanished drops out', async () => {
    const {clock, net, directory, nowS, changes} = setup()
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    net.emit(asEvent(await buildAnnouncement(PUBLIC_SCOPE, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).rooms).toHaveLength(1))
    const before = changes()
    clock.advance(REFRESH_MS)
    expect(changes()).toBe(before + 1)
    clock.advance(300_000)
    expect(directory.view(none).rooms).toHaveLength(0)
  })

  it('a group room carries its group name', async () => {
    const {net, directory, nowS} = setup()
    const group = groupScope(await deriveGroupKeys('motorflash-front'))
    directory.setScopes([PUBLIC_SCOPE, group])
    directory.setActive(true)
    net.emit(asEvent(await buildAnnouncement(group, room, nowS())))
    await vi.waitFor(() => expect(directory.view(none).rooms[0]?.group).toBe('motorflash-front'))
    expect(directory.ownerOf('ABCD2345')).toBe('a'.repeat(64))
  })

  it('a burst of events notifies at most twice per 250 ms (one at once, one at the end)', async () => {
    const {clock, net, directory, nowS, changes} = setup()
    directory.setScopes([PUBLIC_SCOPE])
    directory.setActive(true)
    net.subs[0]?.oneose()
    const before = changes()
    for (let i = 0; i < 50; i++) {
      net.emit(asEvent(await buildAnnouncement(PUBLIC_SCOPE, room, nowS()), i.toString(16).padStart(64, '0')))
    }
    await vi.waitFor(() => expect(directory.view(none).rooms).toHaveLength(1))
    await new Promise(done => setTimeout(done, 50))
    expect(changes() - before).toBe(1)
    clock.advance(NOTIFY_MS)
    expect(changes() - before).toBe(2)
    clock.advance(NOTIFY_MS)
    expect(changes() - before).toBe(2)
  })

  it('every refresh forgets what is no longer fresh before notifying', () => {
    const {clock, directory, nowS, changes} = setup()
    const prune = vi.spyOn(RoomList.prototype, 'prune')
    try {
      directory.setScopes([PUBLIC_SCOPE])
      directory.setActive(true)
      clock.advance(SEARCH_TIMEOUT_MS)
      const before = changes()
      prune.mockImplementation(() => expect(changes()).toBe(before))
      clock.advance(REFRESH_MS - SEARCH_TIMEOUT_MS)
      expect(prune).toHaveBeenCalledWith(nowS())
      expect(changes()).toBe(before + 1)
    } finally {
      prune.mockRestore()
    }
  })
})
