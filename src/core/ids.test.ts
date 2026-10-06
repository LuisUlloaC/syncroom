import {describe, expect, it} from 'vitest'
import {ROOM_CODE_ALPHABET, formatRoomCode, generatePeerId, generateRoomCode, normalizeRoomCode} from './ids'

describe('room codes', () => {
  it('generates 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(8)
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch)
    }
  })

  it('never uses characters that are easy to confuse', () => {
    for (const ch of '01ILOU') expect(ROOM_CODE_ALPHABET).not.toContain(ch)
  })

  it('normalizes what a person types', () => {
    expect(normalizeRoomCode('abcd-2345')).toBe('ABCD2345')
    expect(normalizeRoomCode('  abcd 2345 ')).toBe('ABCD2345')
    expect(normalizeRoomCode('ABCD2345')).toBe('ABCD2345')
  })

  it('rejects wrong lengths and characters outside the alphabet', () => {
    expect(normalizeRoomCode('')).toBeUndefined()
    expect(normalizeRoomCode('ABCD234')).toBeUndefined()
    expect(normalizeRoomCode('ABCD23456')).toBeUndefined()
    expect(normalizeRoomCode('ABCD-2340')).toBeUndefined()
    expect(normalizeRoomCode('ABCD-234O')).toBeUndefined()
    expect(normalizeRoomCode('ABCD-234I')).toBeUndefined()
    expect(normalizeRoomCode('https://youtu.be/x')).toBeUndefined()
  })

  it('formats for display and round-trips', () => {
    expect(formatRoomCode('ABCD2345')).toBe('ABCD-2345')
    const code = generateRoomCode()
    expect(normalizeRoomCode(formatRoomCode(code))).toBe(code)
  })
})

describe('peer ids', () => {
  it('are 12 lowercase alphanumerics and differ between calls', () => {
    const a = generatePeerId()
    const b = generatePeerId()
    expect(a).toMatch(/^[a-z0-9]{12}$/)
    expect(a).not.toBe(b)
  })
})
