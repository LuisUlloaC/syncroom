/** 30 símbolos: sin 0, 1, I, L, O ni U para que el código se pueda dictar. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

const CODE_LENGTH = 8
const PEER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomChars(alphabet: string, length: number): string {
  // Muestreo por rechazo: sin sesgo aunque 256 no sea múltiplo del alfabeto.
  const limit = 256 - (256 % alphabet.length)
  const out: string[] = []
  const buf = new Uint8Array(1)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    const byte = buf[0] ?? 0
    if (byte < limit) out.push(alphabet.charAt(byte % alphabet.length))
  }
  return out.join('')
}

export function generateRoomCode(): string {
  return randomChars(ROOM_CODE_ALPHABET, CODE_LENGTH)
}

export function normalizeRoomCode(input: string): string | undefined {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== CODE_LENGTH) return undefined
  for (const ch of cleaned) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return undefined
  }
  return cleaned
}

export function formatRoomCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function generatePeerId(): string {
  return randomChars(PEER_ALPHABET, 12)
}
