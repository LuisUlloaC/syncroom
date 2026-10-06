import {describe, expect, it} from 'vitest'
import {decryptText, deriveRoomKeys, encryptText} from './crypto'

describe('room keys', () => {
  it('derives the same tag, room id and key from the same code', async () => {
    const a = await deriveRoomKeys('ABCD2345')
    const b = await deriveRoomKeys('ABCD2345')
    expect(a.tag).toBe(b.tag)
    expect(a.roomId).toBe(b.roomId)
    expect(await decryptText(b.aesKey, await encryptText(a.aesKey, 'hola'))).toBe('hola')
  })

  it('derives unrelated values from a different code', async () => {
    const a = await deriveRoomKeys('ABCD2345')
    const b = await deriveRoomKeys('ABCD2346')
    expect(a.tag).not.toBe(b.tag)
    expect(a.roomId).not.toBe(b.roomId)
    await expect(decryptText(b.aesKey, await encryptText(a.aesKey, 'hola'))).rejects.toThrow()
  })

  it('produces 32 hex characters for tag and room id, different from each other', async () => {
    const keys = await deriveRoomKeys('ABCD2345')
    expect(keys.tag).toMatch(/^[0-9a-f]{32}$/)
    expect(keys.roomId).toMatch(/^[0-9a-f]{32}$/)
    expect(keys.tag).not.toBe(keys.roomId)
  })

  it('never exposes the code in tag or room id', async () => {
    const keys = await deriveRoomKeys('ABCD2345')
    expect(`${keys.tag}${keys.roomId}`.toUpperCase()).not.toContain('ABCD2345')
  })
})

describe('encryption', () => {
  it('round-trips unicode and long text', async () => {
    const {aesKey} = await deriveRoomKeys('ABCD2345')
    const text = JSON.stringify({title: 'ROSÉ & Bruno Mars — APT. 🎵', filler: 'x'.repeat(20_000)})
    expect(await decryptText(aesKey, await encryptText(aesKey, text))).toBe(text)
  })

  it('uses a fresh nonce every time', async () => {
    const {aesKey} = await deriveRoomKeys('ABCD2345')
    expect(await encryptText(aesKey, 'same')).not.toBe(await encryptText(aesKey, 'same'))
  })

  it('rejects tampered and malformed payloads', async () => {
    const {aesKey} = await deriveRoomKeys('ABCD2345')
    const payload = await encryptText(aesKey, 'hola')
    const flipped = payload.slice(0, -4) + (payload.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    await expect(decryptText(aesKey, flipped)).rejects.toThrow()
    await expect(decryptText(aesKey, '')).rejects.toThrow()
    await expect(decryptText(aesKey, 'not base64 !!!')).rejects.toThrow()
    await expect(decryptText(aesKey, 'AAAA')).rejects.toThrow()
  })
})
