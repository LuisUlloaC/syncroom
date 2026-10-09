import {describe, expect, it} from 'vitest'
import {
  ANNOUNCE_KIND,
  DELETE_KIND,
  EXPIRY_S,
  PUBLIC_SCOPE,
  PUBLIC_TAG,
  TOMBSTONE_EXPIRY_S,
  announcementId,
  buildAnnouncement,
  buildDeletion,
  buildTombstone,
  capAnnouncement,
  groupScope,
  parseAnnouncement,
  readAnnouncement,
  type Announcement
} from './announcement'
import {sha256Hex} from '../../core/crypto'
import {deriveGroupKeys} from './group-key'
import {asEvent} from './testing'

const base: Announcement = {v: 1, code: 'ABCD2345', owner: 'Luis', playing: 'Song', listeners: 3, locks: {queue: true, playback: false}}
const NOW = 1_760_000_000
const tag = (template: {tags: string[][]}, name: string): string | undefined => template.tags.find(t => t[0] === name)?.[1]

describe('capAnnouncement', () => {
  it('trims, cuts and strips unsafe characters', () => {
    const out = capAnnouncement({...base, owner: `  \u202eLu\nis${'x'.repeat(40)} `, playing: `\u0007${'t'.repeat(200)}`})
    expect(out?.owner).toBe(`Luis${'x'.repeat(28)}`)
    expect(out?.playing).toBe('t'.repeat(120))
  })

  it('strips invisible and bidi characters, tag characters included', () => {
    const out = capAnnouncement({...base, owner: '\u200fL\u200bu\ufeffi\u061cs\u2060\u2064\u{e0001}\u{e007f}', playing: '\u200eSong\u200d'})
    expect(out?.owner).toBe('Luis')
    expect(out?.playing).toBe('Song')
  })

  it.each([
    [0, 1],
    [250, 99],
    [3.6, 4],
    [Number.NaN, 1]
  ])('clamps %d listeners to %d', (listeners, expected) => {
    expect(capAnnouncement({...base, listeners})?.listeners).toBe(expected)
  })

  it('turns an empty title into nothing playing', () => {
    expect(capAnnouncement({...base, playing: '   '})?.playing).toBeNull()
  })

  it.each([
    ['empty owner', {...base, owner: ' \n '}],
    ['lowercase code', {...base, code: 'abcd2345'}],
    ['short code', {...base, code: 'ABCD'}]
  ])('refuses %s', (_label, input) => {
    expect(capAnnouncement(input)).toBeUndefined()
  })
})

describe('parseAnnouncement', () => {
  it('accepts what capAnnouncement produces', () => {
    expect(parseAnnouncement(JSON.parse(JSON.stringify(capAnnouncement(base))))).toEqual(base)
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['version 2', {...base, v: 2}],
    ['lowercase code', {...base, code: 'abcd2345'}],
    ['empty owner', {...base, owner: ''}],
    ['long owner', {...base, owner: 'x'.repeat(33)}],
    ['owner with a newline', {...base, owner: 'Lu\nis'}],
    ['owner with a direction mark', {...base, owner: 'Lu\u202eis'}],
    ['owner with a right-to-left mark', {...base, owner: 'Lu\u200fis'}],
    ['owner with a byte order mark', {...base, owner: '\ufeffLuis'}],
    ['owner with a zero-width space', {...base, owner: 'Lu\u200bis'}],
    ['owner with an Arabic letter mark', {...base, owner: 'Lu\u061cis'}],
    ['owner with a word joiner', {...base, owner: 'Lu\u2060is'}],
    ['owner with a tag character', {...base, owner: 'Luis\u{e0041}'}],
    ['long title', {...base, playing: 't'.repeat(121)}],
    ['empty title', {...base, playing: ''}],
    ['zero listeners', {...base, listeners: 0}],
    ['fractional listeners', {...base, listeners: 1.5}],
    ['too many listeners', {...base, listeners: 100}],
    ['string lock', {...base, locks: {queue: 'yes', playback: false}}],
    ['missing locks', {...base, locks: undefined}]
  ])('rejects %s', (_label, value) => {
    expect(parseAnnouncement(value)).toBeUndefined()
  })
})

describe('announcement events', () => {
  it('ids are 32 hex characters, different per scope and per code', async () => {
    const group = groupScope(await deriveGroupKeys('motorflash-front'))
    const a = await announcementId(PUBLIC_SCOPE, 'ABCD2345')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(await announcementId(PUBLIC_SCOPE, 'ABCD2346'))
    expect(a).not.toBe(await announcementId(group, 'ABCD2345'))
  })

  it('a group id is keyed with the word: the public tag alone does not let anyone test codes against it', async () => {
    const keys = await deriveGroupKeys('motorflash-front')
    const other = await deriveGroupKeys('motorflash-back')
    const id = await announcementId(groupScope(keys), 'ABCD2345')
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(id).not.toBe((await sha256Hex(`${keys.tag}:ABCD2345`)).slice(0, 32))
    expect(id).not.toBe(await announcementId(groupScope(other), 'ABCD2345'))
    // Misma etiqueta, otra palabra: el `d` depende del secreto, no solo de la etiqueta.
    expect(id).not.toBe(await announcementId({...groupScope(keys), idKey: other.idKey}, 'ABCD2345'))
    expect(id).toBe(await announcementId(groupScope(await deriveGroupKeys('Motorflash-Front')), 'ABCD2345'))
  })

  it('the public id stays sha256(tag:code), since the public code travels in clear anyway', async () => {
    expect(await announcementId(PUBLIC_SCOPE, 'ABCD2345')).toBe((await sha256Hex(`${PUBLIC_TAG}:ABCD2345`)).slice(0, 32))
  })

  it('a group tombstone shares the key of its announcement', async () => {
    const scope = groupScope(await deriveGroupKeys('motorflash-front'))
    const announced = await readAnnouncement(asEvent(await buildAnnouncement(scope, base, NOW)), [scope])
    const closed = await readAnnouncement(asEvent(await buildTombstone(scope, base.code, NOW + 1)), [scope])
    expect(announced?.announcement).toEqual(base)
    expect(closed).toMatchObject({key: announced?.key, announcement: null})
  })

  it('a public announcement goes in clear with the public tag and expires on the relay', async () => {
    const template = await buildAnnouncement(PUBLIC_SCOPE, base, NOW)
    expect(template.kind).toBe(ANNOUNCE_KIND)
    expect(tag(template, 't')).toBe(PUBLIC_TAG)
    expect(tag(template, 'expiration')).toBe(String(NOW + EXPIRY_S))
    expect(JSON.parse(template.content)).toEqual(base)
    expect(await readAnnouncement(asEvent(template), [PUBLIC_SCOPE])).toEqual({
      key: `${'a'.repeat(64)}:${await announcementId(PUBLIC_SCOPE, base.code)}`,
      pubkey: 'a'.repeat(64),
      createdAt: NOW,
      group: null,
      announcement: base
    })
  })

  it('a group announcement is encrypted and only its group reads it', async () => {
    const keys = await deriveGroupKeys('motorflash-front')
    const other = await deriveGroupKeys('motorflash-back')
    const template = await buildAnnouncement(groupScope(keys), base, NOW)
    expect(template.content).not.toContain('Luis')
    expect((await readAnnouncement(asEvent(template), [PUBLIC_SCOPE, groupScope(keys)]))?.group).toBe('motorflash-front')
    expect(await readAnnouncement(asEvent(template), [PUBLIC_SCOPE])).toBeUndefined()
    // Alguien que conoce la etiqueta pero no la palabra.
    const impostor = {tag: keys.tag, key: other.aesKey, group: 'guess'}
    expect(await readAnnouncement(asEvent(template), [impostor])).toBeUndefined()
  })

  it('a tombstone shares the key of the announcement and reads as a closed room', async () => {
    const announced = await readAnnouncement(asEvent(await buildAnnouncement(PUBLIC_SCOPE, base, NOW)), [PUBLIC_SCOPE])
    const tombstone = await buildTombstone(PUBLIC_SCOPE, base.code, NOW + 1)
    expect(tag(tombstone, 'expiration')).toBe(String(NOW + 1 + TOMBSTONE_EXPIRY_S))
    const closed = await readAnnouncement(asEvent(tombstone), [PUBLIC_SCOPE])
    expect(closed).toMatchObject({key: announced?.key, announcement: null, createdAt: NOW + 1})
  })

  it('the deletion points at the addressable announcement', async () => {
    const pubkey = 'c'.repeat(64)
    const deletion = await buildDeletion(PUBLIC_SCOPE, base.code, pubkey, NOW)
    expect(deletion.kind).toBe(DELETE_KIND)
    expect(deletion.tags).toEqual([['a', `${ANNOUNCE_KIND}:${pubkey}:${await announcementId(PUBLIC_SCOPE, base.code)}`]])
  })

  it('ignores the wrong kind, oversized content, a missing or forged id and broken JSON', async () => {
    const good = await buildAnnouncement(PUBLIC_SCOPE, base, NOW)
    const otherId = await announcementId(PUBLIC_SCOPE, 'ZZZZ2345')
    const variants = [
      {...good, kind: 1},
      {...good, content: 'x'.repeat(2001)},
      {...good, tags: good.tags.filter(t => t[0] !== 'd')},
      {...good, tags: good.tags.map(t => (t[0] === 'd' ? ['d', otherId] : t))},
      {...good, content: '{not json'}
    ]
    for (const variant of variants) expect(await readAnnouncement(asEvent(variant), [PUBLIC_SCOPE])).toBeUndefined()
  })
})
