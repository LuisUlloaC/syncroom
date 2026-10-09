import {describe, expect, it} from 'vitest'
import type {Announcement, Incoming} from './announcement'
import {FRESH_PAST_S, MAX_ENTRIES, MAX_PER_PUBKEY, RoomList} from './room-list'

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
    expect(list.apply({...incoming('p1', NOW, room('ABCD2345', {locks: {queue: false, playback: true}})), group: 'equipo-front'}, NOW)).toBe(true)
    expect(list.rows(NOW, none)).toEqual({
      rows: [{code: 'ABCD2345', owner: 'Ana', playing: 'Song', listeners: 2, locked: true, group: 'equipo-front'}],
      hiddenCount: 0
    })
  })

  it('keeps a room alive up to 5 minutes old and 5 minutes in the future', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW - 299, room('AAAA2345')), NOW)
    list.apply(incoming('p2', NOW - 301, room('BBBB2345')), NOW)
    list.apply(incoming('p3', NOW + 299, room('CCCC2345')), NOW)
    list.apply(incoming('p4', NOW + 301, room('DDDD2345')), NOW)
    expect(codes(list).sort()).toEqual(['AAAA2345', 'CCCC2345'])
  })

  it('a tombstone removes the room', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345')), NOW)
    expect(list.apply(incoming('p1', NOW + 1, null, 'ABCD2345'), NOW)).toBe(true)
    expect(codes(list)).toEqual([])
  })

  it('an older announcement after its tombstone is ignored (relays deliver out of order)', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW + 5, null, 'ABCD2345'), NOW)
    expect(list.apply(incoming('p1', NOW, room('ABCD2345')), NOW)).toBe(false)
    expect(codes(list)).toEqual([])
  })

  it('ignores an older or repeated copy of the same announcement', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345', {listeners: 5})), NOW)
    expect(list.apply(incoming('p1', NOW - 60, room('ABCD2345', {listeners: 1})), NOW)).toBe(false)
    expect(list.apply(incoming('p1', NOW, room('ABCD2345', {listeners: 5})), NOW)).toBe(false)
    expect(list.rows(NOW, none).rows[0]?.listeners).toBe(5)
  })

  it('one row per code: the newest first, and then whoever we already showed keeps it', () => {
    const list = new RoomList()
    list.apply(incoming('owner', NOW - 10, room('ABCD2345', {owner: 'Ana'})), NOW)
    list.apply(incoming('early', NOW - 20, room('ABCD2345', {owner: 'Old'})), NOW)
    expect(list.rows(NOW, none).rows.map(r => r.owner)).toEqual(['Ana'])
    expect(list.ownerOf('ABCD2345')).toBe('owner')
    // Un impostor más reciente con el mismo código no se queda con la fila.
    list.apply(incoming('impostor', NOW, room('ABCD2345', {owner: 'Fake'})), NOW)
    expect(list.rows(NOW, none).rows.map(r => r.owner)).toEqual(['Ana'])
  })

  it('hides by room and by creator, and counts what it hid', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('AAAA2345')), NOW)
    list.apply(incoming('p2', NOW, room('BBBB2345')), NOW)
    list.apply(incoming('p3', NOW, room('CCCC2345')), NOW)
    const out = list.rows(NOW, {rooms: ['AAAA2345'], owners: ['p2']})
    expect(out.rows.map(r => r.code)).toEqual(['CCCC2345'])
    expect(out.hiddenCount).toBe(2)
  })

  it('sorts by listeners, then by most recent, and shows at most 50', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW - 5, room('AAAA2345', {listeners: 2})), NOW)
    list.apply(incoming('p2', NOW, room('BBBB2345', {listeners: 2})), NOW)
    list.apply(incoming('p3', NOW - 9, room('CCCC2345', {listeners: 7})), NOW)
    expect(codes(list)).toEqual(['CCCC2345', 'BBBB2345', 'AAAA2345'])
    // RoomList no valida códigos (eso lo hace readAnnouncement): basta con que sean únicos.
    const many = new RoomList()
    for (let i = 0; i < 60; i++) many.apply(incoming(`p${i}`, NOW, room(`ROOM${i}`)), NOW)
    expect(many.rows(NOW, none).rows).toHaveLength(50)
  })

  it('a tombstone for a room we never saw is kept only while it is fresh, and pruned afterwards', () => {
    const list = new RoomList()
    expect(list.apply(incoming('p1', NOW - FRESH_PAST_S - 1, null, 'ABCD2345'), NOW)).toBe(false)
    expect(list.apply(incoming('p2', NOW + 3600, null, 'ABCD2345'), NOW)).toBe(false)
    expect(list.size).toBe(0)
    expect(list.apply(incoming('p3', NOW, null, 'ABCD2345'), NOW)).toBe(true)
    expect(list.size).toBe(1)
    list.prune(NOW + FRESH_PAST_S + 1)
    expect(list.size).toBe(0)
  })

  it('prune drops every entry older than the freshness window, live or tombstone', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW - 200, room('AAAA2345')), NOW)
    list.apply(incoming('p2', NOW - 100, null, 'BBBB2345'), NOW)
    list.apply(incoming('p3', NOW, room('CCCC2345')), NOW)
    list.prune(NOW + FRESH_PAST_S - 150)
    expect(list.size).toBe(2)
    list.prune(NOW + FRESH_PAST_S - 50)
    expect(list.size).toBe(1)
    expect(codes(list, NOW + FRESH_PAST_S - 50)).toEqual(['CCCC2345'])
  })

  it(`holds at most ${MAX_ENTRIES} entries and evicts the oldest`, () => {
    const list = new RoomList()
    // Con más oyentes que nadie: si siguiera guardada saldría la primera.
    list.apply(incoming('oldest', NOW - 100, room('OLD00000', {listeners: 99})), NOW)
    for (let i = 1; i < MAX_ENTRIES; i++) list.apply(incoming(`p${i}`, NOW, room(`R${i}`)), NOW)
    expect(list.size).toBe(MAX_ENTRIES)
    expect(codes(list, NOW)[0]).toBe('OLD00000')
    expect(list.apply(incoming('newcomer', NOW + 1, room('NEW00000')), NOW)).toBe(true)
    expect(list.size).toBe(MAX_ENTRIES)
    const shown = codes(list, NOW)
    expect(shown).not.toContain('OLD00000')
    // Lleno, algo más antiguo que todo lo guardado no entra.
    expect(list.apply(incoming('late', NOW - 200, room('LATE0000')), NOW)).toBe(false)
    expect(list.size).toBe(MAX_ENTRIES)
  })

  it(`holds at most ${MAX_PER_PUBKEY} entries per creator and evicts that creator's oldest`, () => {
    const list = new RoomList()
    for (let i = 0; i <= MAX_PER_PUBKEY; i++) list.apply(incoming('spammer', NOW - 100 + i, room(`S${i}`)), NOW)
    list.apply(incoming('other', NOW - 200, room('OTHER000')), NOW)
    expect(list.size).toBe(MAX_PER_PUBKEY + 1)
    const shown = codes(list, NOW)
    expect(shown).not.toContain('S0')
    expect(shown).toContain(`S${MAX_PER_PUBKEY}`)
    expect(shown).toContain('OTHER000')
  })

  it('hiding an impersonator keeps the real room visible', () => {
    const list = new RoomList()
    list.apply(incoming('owner', NOW - 10, room('ABCD2345', {owner: 'Ana'})), NOW)
    // Con fecha adelantada, un recién llegado a la lista elige al impostor.
    list.apply(incoming('impostor', NOW + 200, room('ABCD2345', {owner: 'Fake'})), NOW)
    expect(list.rows(NOW, none).rows.map(r => r.owner)).toEqual(['Fake'])
    const out = list.rows(NOW, {rooms: [], owners: ['impostor']})
    expect(out.rows.map(r => r.owner)).toEqual(['Ana'])
    expect(out.hiddenCount).toBe(0)
    expect(list.ownerOf('ABCD2345')).toBe('owner')
  })

  it('clear forgets everything', () => {
    const list = new RoomList()
    list.apply(incoming('p1', NOW, room('ABCD2345')), NOW)
    list.rows(NOW, none)
    list.clear()
    expect(codes(list)).toEqual([])
    expect(list.ownerOf('ABCD2345')).toBeUndefined()
  })
})
