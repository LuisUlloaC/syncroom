import {describe, expect, it} from 'vitest'
import type {Announcement, Incoming} from './announcement'
import {RoomList} from './room-list'

const NOW = 1_760_000_000
const none = {rooms: [], owners: []}

function room(code: string, extra: Partial<Announcement> = {}): Announcement {
  return {v: 1, code, owner: 'Ana', playing: 'Song', listeners: 2, locks: {queue: false, playback: false}, ...extra}
}

function incoming(pubkey: string, createdAt: number, announcement: Announcement | null, code = announcement?.code ?? 'ABCD2345'): Incoming {
  return {key: `${pubkey}:${code}`, pubkey, createdAt, group: null, announcement}
}

const codes = (list: RoomList, now = NOW, hidden = none): string[] => list.rows(now, hidden).rows.map(r => r.code)

describe('RoomList', () => {
  it('shows a fresh room with its details', () => {
    const list = new RoomList()
    expect(list.apply({...incoming('p1', NOW, room('ABCD2345', {locks: {queue: false, playback: true}})), group: 'equipo-front'})).toBe(true)
    expect(list.rows(NOW, none)).toEqual({
      rows: [{code: 'ABCD2345', owner: 'Ana', playing: 'Song', listeners: 2, locked: true, group: 'equipo-front'}],
      hiddenCount: 0
    })
  })

  it('keeps a room alive up to 5 minutes old and 5 minutes in the future', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW - 299, room('AAAA2345')))
    list.apply(incoming('p2', NOW - 301, room('BBBB2345')))
    list.apply(incoming('p3', NOW + 299, room('CCCC2345')))
    list.apply(incoming('p4', NOW + 301, room('DDDD2345')))
    expect(codes(list).sort()).toEqual(['AAAA2345', 'CCCC2345'])
  })

  it('a tombstone removes the room', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345')))
    expect(list.apply(incoming('p1', NOW + 1, null, 'ABCD2345'))).toBe(true)
    expect(codes(list)).toEqual([])
  })

  it('an older announcement after its tombstone is ignored (relays deliver out of order)', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW + 5, null, 'ABCD2345'))
    expect(list.apply(incoming('p1', NOW, room('ABCD2345')))).toBe(false)
    expect(codes(list)).toEqual([])
  })

  it('ignores an older or repeated copy of the same announcement', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345', {listeners: 5})))
    expect(list.apply(incoming('p1', NOW - 60, room('ABCD2345', {listeners: 1})))).toBe(false)
    expect(list.apply(incoming('p1', NOW, room('ABCD2345', {listeners: 5})))).toBe(false)
    expect(list.rows(NOW, none).rows[0]?.listeners).toBe(5)
  })

  it('one row per code: the newest first, and then whoever we already showed keeps it', () => {
    const list = new RoomList()
    list.apply(incoming('owner', NOW - 10, room('ABCD2345', {owner: 'Ana'})))
    list.apply(incoming('early', NOW - 20, room('ABCD2345', {owner: 'Old'})))
    expect(list.rows(NOW, none).rows.map(r => r.owner)).toEqual(['Ana'])
    expect(list.ownerOf('ABCD2345')).toBe('owner')
    // Un impostor más reciente con el mismo código no se queda con la fila.
    list.apply(incoming('impostor', NOW, room('ABCD2345', {owner: 'Fake'})))
    expect(list.rows(NOW, none).rows.map(r => r.owner)).toEqual(['Ana'])
  })

  it('hides by room and by creator, and counts what it hid', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('AAAA2345')))
    list.apply(incoming('p2', NOW, room('BBBB2345')))
    list.apply(incoming('p3', NOW, room('CCCC2345')))
    const out = list.rows(NOW, {rooms: ['AAAA2345'], owners: ['p2']})
    expect(out.rows.map(r => r.code)).toEqual(['CCCC2345'])
    expect(out.hiddenCount).toBe(2)
  })

  it('sorts by listeners, then by most recent, and shows at most 50', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW - 5, room('AAAA2345', {listeners: 2})))
    list.apply(incoming('p2', NOW, room('BBBB2345', {listeners: 2})))
    list.apply(incoming('p3', NOW - 9, room('CCCC2345', {listeners: 7})))
    expect(codes(list)).toEqual(['CCCC2345', 'BBBB2345', 'AAAA2345'])
    // RoomList no valida códigos (eso lo hace readAnnouncement): basta con que sean únicos.
    const many = new RoomList()
    for (let i = 0; i < 60; i++) many.apply(incoming(`p${i}`, NOW, room(`ROOM${i}`)))
    expect(many.rows(NOW, none).rows).toHaveLength(50)
  })

  it('clear forgets everything', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345')))
    list.rows(NOW, none)
    list.clear()
    expect(codes(list)).toEqual([])
    expect(list.ownerOf('ABCD2345')).toBeUndefined()
  })
})
