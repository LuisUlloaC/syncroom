export interface RoomKeys {
  /** Cifra los mensajes que pasan por los relays. */
  aesKey: CryptoKey
  /** Etiqueta pública con la que se filtran los eventos en los relays. */
  tag: string
  /** Identificador de la sala para Trystero. */
  roomId: string
}

const ROOM_SALT = 'syncroom:v1'
// Caro a propósito: el código de sala tiene ~39 bits y la etiqueta es pública.
const ITERATIONS = 100_000
const NONCE_BYTES = 12

export function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** PBKDF2-SHA-256 de `secret` con `salt`. Lo usan las salas (código) y los grupos (palabra). */
export async function stretch(secret: string, salt: string, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: 'SHA-256'},
    material,
    bytes * 8
  )
  return new Uint8Array(bits)
}

export function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function deriveRoomKeys(code: string): Promise<RoomKeys> {
  const bits = await stretch(code, ROOM_SALT, 64)
  return {aesKey: await importAesKey(bits.slice(0, 32)), tag: hex(bits.slice(32, 48)), roomId: hex(bits.slice(48, 64))}
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, new TextEncoder().encode(text)))
  const out = new Uint8Array(nonce.length + cipher.length)
  out.set(nonce, 0)
  out.set(cipher, nonce.length)
  return toBase64(out)
}

/** Lanza si el texto no se cifró con esta clave o fue alterado. */
export async function decryptText(key: CryptoKey, payload: string): Promise<string> {
  const bytes = fromBase64(payload)
  if (bytes.length <= NONCE_BYTES) throw new Error('payload too short')
  const plain = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: bytes.slice(0, NONCE_BYTES)},
    key,
    bytes.slice(NONCE_BYTES)
  )
  return new TextDecoder().decode(plain)
}
