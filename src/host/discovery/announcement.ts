import type {Event, EventTemplate} from 'nostr-tools/core'
import {decryptText, encryptText, sha256Hex} from '../../core/crypto'
import {normalizeRoomCode} from '../../core/ids'
import type {GroupKeys} from './group-key'

/** Direccionable (30000–39999): el relay guarda solo el último por clave pública + `d`. */
export const ANNOUNCE_KIND = 30777
export const DELETE_KIND = 5
export const PUBLIC_TAG = 'syncroom-public-v1'
/** Limpieza en el relay (NIP-40). Si la sala sigue viva lo decide la lista, no esto. */
export const EXPIRY_S = 600
export const TOMBSTONE_EXPIRY_S = 60
export const MAX_OWNER = 32
export const MAX_PLAYING = 120
export const MAX_LISTENERS = 99
const MAX_CONTENT = 2000
const MAX_ID = 64
/** Control, separadores de línea y marcas de dirección: con ellas un nombre puede fingir ser otro. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
const UNSAFE_ALL = new RegExp(UNSAFE.source, 'g')

export interface Announcement {
  v: 1
  code: string
  owner: string
  playing: string | null
  listeners: number
  locks: {queue: boolean; playback: boolean}
}

/** Dónde se anuncia: la lista pública (en claro) o un grupo (etiqueta y clave sacadas de su palabra). */
export interface Scope {
  tag: string
  key?: CryptoKey
  /** Palabra del grupo; null en la lista pública. */
  group: string | null
}

export const PUBLIC_SCOPE: Scope = {tag: PUBLIC_TAG, group: null}

export function groupScope(keys: GroupKeys): Scope {
  return {tag: keys.tag, key: keys.aesKey, group: keys.word}
}

/** Lo que llega de un relay, ya validado. `announcement: null` = la sala se dio de baja (lápida). */
export interface Incoming {
  /** `pubkey:d`: identifica el anuncio de una sala de un emisor en un ámbito. */
  key: string
  pubkey: string
  createdAt: number
  group: string | null
  announcement: Announcement | null
}

function clean(text: string, max: number): string {
  return text.replace(UNSAFE_ALL, '').trim().slice(0, max)
}

function isSafeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max && !UNSAFE.test(value)
}

/** Lo que se publica: limpio y acotado. undefined si no hay nada que anunciar con sentido. */
export function capAnnouncement(input: Omit<Announcement, 'v'>): Announcement | undefined {
  const owner = clean(input.owner, MAX_OWNER)
  if (owner === '' || normalizeRoomCode(input.code) !== input.code) return undefined
  const playing = input.playing === null ? '' : clean(input.playing, MAX_PLAYING)
  const listeners = Number.isFinite(input.listeners) ? Math.round(input.listeners) : 1
  return {
    v: 1,
    code: input.code,
    owner,
    playing: playing === '' ? null : playing,
    listeners: Math.min(MAX_LISTENERS, Math.max(1, listeners)),
    locks: {queue: input.locks.queue, playback: input.locks.playback}
  }
}

/** Lo que llega de la red no es de fiar: solo pasa lo que tiene exactamente la forma esperada. */
export function parseAnnouncement(value: unknown): Announcement | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (v.v !== 1 || typeof v.code !== 'string' || normalizeRoomCode(v.code) !== v.code) return undefined
  const owner = v.owner
  if (!isSafeText(owner, MAX_OWNER)) return undefined
  const playing = v.playing === null ? null : isSafeText(v.playing, MAX_PLAYING) ? v.playing : undefined
  if (playing === undefined) return undefined
  const listeners = v.listeners
  if (typeof listeners !== 'number' || !Number.isInteger(listeners) || listeners < 1 || listeners > MAX_LISTENERS) return undefined
  const locks = v.locks
  if (typeof locks !== 'object' || locks === null) return undefined
  const {queue, playback} = locks as Record<string, unknown>
  if (typeof queue !== 'boolean' || typeof playback !== 'boolean') return undefined
  return {v: 1, code: v.code, owner, playing, listeners, locks: {queue, playback}}
}

/** `d` del anuncio: estable por sala y ámbito, y no revela el código fuera del ámbito. */
export async function announcementId(scope: Scope, code: string): Promise<string> {
  return (await sha256Hex(`${scope.tag}:${code}`)).slice(0, 32)
}

export async function buildAnnouncement(scope: Scope, announcement: Announcement, createdAt: number): Promise<EventTemplate> {
  const json = JSON.stringify(announcement)
  return {
    kind: ANNOUNCE_KIND,
    created_at: createdAt,
    tags: [
      ['d', await announcementId(scope, announcement.code)],
      ['t', scope.tag],
      ['expiration', String(createdAt + EXPIRY_S)]
    ],
    content: scope.key === undefined ? json : await encryptText(scope.key, json)
  }
}

/** Sustituye al anuncio en el relay: contenido vacío = sala cerrada. */
export async function buildTombstone(scope: Scope, code: string, createdAt: number): Promise<EventTemplate> {
  return {
    kind: ANNOUNCE_KIND,
    created_at: createdAt,
    tags: [
      ['d', await announcementId(scope, code)],
      ['t', scope.tag],
      ['expiration', String(createdAt + TOMBSTONE_EXPIRY_S)]
    ],
    content: ''
  }
}

/** Borrado NIP-09: los relays que lo respetan quitan el anuncio antes de que caduque. */
export async function buildDeletion(scope: Scope, code: string, pubkey: string, createdAt: number): Promise<EventTemplate> {
  return {
    kind: DELETE_KIND,
    created_at: createdAt,
    tags: [['a', `${ANNOUNCE_KIND}:${pubkey}:${await announcementId(scope, code)}`]],
    content: ''
  }
}

const tagValue = (event: Event, name: string): string | undefined => event.tags.find(tag => tag[0] === name)?.[1]

export async function readAnnouncement(event: Event, scopes: Scope[]): Promise<Incoming | undefined> {
  if (event.kind !== ANNOUNCE_KIND || event.content.length > MAX_CONTENT) return undefined
  const id = tagValue(event, 'd')
  const scope = scopes.find(candidate => candidate.tag === tagValue(event, 't'))
  if (id === undefined || id === '' || id.length > MAX_ID || scope === undefined) return undefined
  const base = {key: `${event.pubkey}:${id}`, pubkey: event.pubkey, createdAt: event.created_at, group: scope.group}
  if (event.content === '') return {...base, announcement: null}
  let value: unknown
  try {
    value = JSON.parse(scope.key === undefined ? event.content : await decryptText(scope.key, event.content))
  } catch {
    return undefined // no es de este ámbito, está alterado o no es JSON
  }
  const announcement = parseAnnouncement(value)
  // El `d` tiene que corresponder al código: así la lápida de una sala siempre casa con su anuncio.
  if (announcement === undefined || id !== (await announcementId(scope, announcement.code))) return undefined
  return {...base, announcement}
}
