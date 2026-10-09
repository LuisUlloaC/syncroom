import {describe, expect, it, vi} from 'vitest'
import {
  ANNOUNCE_KIND,
  DELETE_KIND,
  EXPIRY_S,
  PUBLIC_SCOPE,
  PUBLIC_TAG,
  announcementId,
  groupScope,
  type Announcement
} from './announcement'
import {Announcer, MIN_GAP_MS, RENEW_MS} from './announcer'
import {deriveGroupKeys} from './group-key'
import {FakeClock, FakeNet} from './testing'

const snap: Announcement = {v: 1, code: 'ABCD2345', owner: 'Luis', playing: 'Song', listeners: 2, locks: {queue: true, playback: true}}
const tag = (template: {tags: string[][]}, name: string): string | undefined => template.tags.find(t => t[0] === name)?.[1]

function setup() {
  const clock = new FakeClock()
  const net = new FakeNet()
  const status: number[] = []
  const announcer = new Announcer({net, clock, onStatus: ok => status.push(ok)})
  const published = (n: number) => vi.waitFor(() => expect(net.published).toHaveLength(n))
  return {clock, net, status, announcer, published}
}

describe('Announcer', () => {
  it('announces at once, then renews every minute', async () => {
    const {clock, net, status, announcer, published} = setup()
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    const first = net.published[0]
    expect(first?.kind).toBe(ANNOUNCE_KIND)
    expect(tag(first ?? {tags: []}, 't')).toBe(PUBLIC_TAG)
    expect(JSON.parse(first?.content ?? '')).toEqual(snap)
    expect(tag(first ?? {tags: []}, 'expiration')).toBe(String((first?.created_at ?? 0) + EXPIRY_S))
    await vi.waitFor(() => expect(status).toEqual([4]))
    clock.advance(RENEW_MS)
    await published(2)
    clock.advance(RENEW_MS)
    await published(3)
  })

  it('a change goes out early, but never twice within 10 seconds', async () => {
    const {clock, net, announcer, published} = setup()
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    clock.advance(3000)
    announcer.update(PUBLIC_SCOPE, {...snap, listeners: 3})
    announcer.update(PUBLIC_SCOPE, {...snap, listeners: 4})
    clock.advance(MIN_GAP_MS - 3000 - 1)
    await new Promise(done => setTimeout(done, 20))
    expect(net.published).toHaveLength(1)
    clock.advance(1)
    await published(2)
    expect(JSON.parse(net.published[1]?.content ?? '').listeners).toBe(4)
    // Lo mismo otra vez no publica nada hasta la renovación.
    announcer.update(PUBLIC_SCOPE, {...snap, listeners: 4})
    clock.advance(MIN_GAP_MS)
    await new Promise(done => setTimeout(done, 20))
    expect(net.published).toHaveLength(2)
  })

  it('stop publishes a tombstone and a NIP-09 deletion, then nothing else', async () => {
    const {clock, net, announcer, published} = setup()
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    await announcer.stop()
    await published(3)
    const [, tombstone, deletion] = net.published
    expect(tombstone?.kind).toBe(ANNOUNCE_KIND)
    expect(tombstone?.content).toBe('')
    expect(tag(tombstone ?? {tags: []}, 'd')).toBe(await announcementId(PUBLIC_SCOPE, snap.code))
    expect(deletion?.kind).toBe(DELETE_KIND)
    expect(deletion?.tags).toEqual([['a', `${ANNOUNCE_KIND}:${net.pubkey}:${await announcementId(PUBLIC_SCOPE, snap.code)}`]])
    clock.advance(RENEW_MS * 3)
    await new Promise(done => setTimeout(done, 20))
    expect(net.published).toHaveLength(3)
  })

  it('moving to a group retires the public announcement and announces encrypted in the group', async () => {
    const {clock, net, announcer, published} = setup()
    const group = groupScope(await deriveGroupKeys('motorflash-front'))
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    announcer.update(group, snap)
    await published(3) // lápida + borrado del público
    expect(tag(net.published[1] ?? {tags: []}, 't')).toBe(PUBLIC_TAG)
    expect(net.published[1]?.content).toBe('')
    clock.advance(MIN_GAP_MS)
    await published(4)
    const grouped = net.published[3]
    expect(tag(grouped ?? {tags: []}, 't')).toBe(group.tag)
    expect(grouped?.content).not.toContain('Luis')
  })

  it('leaving and coming back at once ends announced (the new announcement is newer than the tombstone)', async () => {
    const {clock, net, announcer, published} = setup()
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    announcer.update(undefined, undefined)
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(MIN_GAP_MS)
    await published(4)
    const last = net.published[3]
    expect(last?.kind).toBe(ANNOUNCE_KIND)
    expect(last?.content).not.toBe('')
    expect(last?.created_at).toBeGreaterThan(net.published[1]?.created_at ?? Infinity)
  })

  it('created_at always grows, even within the same second', async () => {
    const {clock, net, announcer, published} = setup()
    announcer.update(PUBLIC_SCOPE, snap)
    clock.advance(0)
    await published(1)
    await announcer.stop()
    await published(3)
    const times = net.published.map(e => e.created_at)
    expect(times[1]).toBeGreaterThan(times[0] ?? Infinity)
  })
})
