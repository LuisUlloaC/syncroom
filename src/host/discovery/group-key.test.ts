import {describe, expect, it} from 'vitest'
import {decryptText, deriveRoomKeys, encryptText} from '../../core/crypto'
import {deriveGroupKeys, normalizeGroupWord} from './group-key'

describe('group word', () => {
  it('normalizes case and spaces', () => {
    expect(normalizeGroupWord('  Motorflash   Front ')).toBe('motorflash front')
  })

  it('an accented word typed decomposed (macOS) or composed (Windows) is the same word', async () => {
    const decomposed = 'cafe\u0301 group'
    const composed = 'caf\u00e9 group'
    expect(normalizeGroupWord(decomposed)).toBe(composed)
    expect((await deriveGroupKeys(decomposed)).tag).toBe((await deriveGroupKeys(composed)).tag)
  })

  it.each(['', 'short', '1234567', 'x'.repeat(65)])('rejects %j', word => {
    expect(normalizeGroupWord(word)).toBeUndefined()
  })

  it('accepts 8 and 64 characters', () => {
    expect(normalizeGroupWord('12345678')).toBe('12345678')
    expect(normalizeGroupWord('x'.repeat(64))).toBe('x'.repeat(64))
  })
})

describe('group keys', () => {
  it('the same word (any case or spacing) gives the same tag and key', async () => {
    const a = await deriveGroupKeys('Motorflash Front')
    const b = await deriveGroupKeys(' motorflash  front')
    expect(a.word).toBe('motorflash front')
    expect(a.tag).toBe(b.tag)
    expect(a.tag).toMatch(/^[0-9a-f]{32}$/)
    expect(await decryptText(b.aesKey, await encryptText(a.aesKey, 'hola'))).toBe('hola')
  })

  it('a different word cannot read the group', async () => {
    const a = await deriveGroupKeys('motorflash-front')
    const b = await deriveGroupKeys('motorflash-back')
    expect(a.tag).not.toBe(b.tag)
    await expect(decryptText(b.aesKey, await encryptText(a.aesKey, 'hola'))).rejects.toThrow()
  })

  it('never matches a room derived from the same text', async () => {
    const group = await deriveGroupKeys('ABCD2345')
    const room = await deriveRoomKeys('abcd2345')
    expect(group.tag).not.toBe(room.tag)
  })

  it('refuses an invalid word', async () => {
    await expect(deriveGroupKeys('short')).rejects.toThrow()
  })
})
