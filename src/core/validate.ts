import {generateKeyBetween} from 'fractional-indexing'
import {MAX_COUNTER} from './stamp'
import type {PlaybackWire, RoomMessage, Stamp, Track} from './types'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_ID = 64
const MAX_NAME = 40
const MAX_TITLE = 300
export const MAX_CHAT = 500
const MAX_TRACKS = 500
const MAX_RANK = 256
/** Alfabeto base62 de fractional-indexing. */
const RANK = /^[0-9A-Za-z]+$/
export const MAX_REMOVED = 5000
const MAX_POSITION_S = 24 * 60 * 60
const MAX_AGE_MS = 24 * 60 * 60 * 1000

type Dict = Record<string, unknown>

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function isId(value: unknown): value is string {
  return isText(value, MAX_ID) && value.length > 0
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Un rank válido para fractional-indexing: si no lo es, cualquier generación posterior lanzaría. */
function isRank(value: unknown): value is string {
  if (!isText(value, MAX_RANK) || !RANK.test(value)) return false
  try {
    generateKeyBetween(value, null)
    return true
  } catch {
    return false
  }
}

function isStamp(value: unknown): value is Stamp {
  return isDict(value) && isNumberIn(value.counter, 0, MAX_COUNTER) && Number.isInteger(value.counter) && isText(value.peerId, MAX_ID)
}

function isTrack(value: unknown): value is Track {
  return (
    isDict(value) &&
    isId(value.id) &&
    typeof value.videoId === 'string' &&
    VIDEO_ID.test(value.videoId) &&
    isText(value.title, MAX_TITLE) &&
    isText(value.author, MAX_TITLE) &&
    isText(value.addedBy, MAX_NAME) &&
    isStamp(value.order) &&
    isRank(value.rank) &&
    isStamp(value.moved)
  )
}

function isTrackList(value: unknown): value is Track[] {
  return Array.isArray(value) && value.length <= MAX_TRACKS && value.every(isTrack)
}

function isPlaybackWire(value: unknown): value is PlaybackWire {
  return (
    isDict(value) &&
    (value.trackId === null || isId(value.trackId)) &&
    typeof value.playing === 'boolean' &&
    isNumberIn(value.positionS, 0, MAX_POSITION_S) &&
    isNumberIn(value.ageMs, 0, MAX_AGE_MS) &&
    isStamp(value.stamp)
  )
}

/** Lo que llega de la red no es de fiar: solo pasa lo que tiene exactamente la forma esperada. */
export function isRoomMessage(value: unknown): value is RoomMessage {
  if (!isDict(value) || !isId(value.from)) return false
  switch (value.type) {
    case 'hello':
      return isText(value.name, MAX_NAME) && isText(value.digest, MAX_ID)
    case 'state':
      return (
        isText(value.name, MAX_NAME) &&
        isTrackList(value.tracks) &&
        Array.isArray(value.removed) &&
        value.removed.length <= MAX_REMOVED &&
        value.removed.every(isId) &&
        isPlaybackWire(value.playback)
      )
    case 'add':
      return isTrackList(value.tracks)
    case 'remove':
      return isId(value.trackId)
    case 'move':
      return isId(value.trackId) && isRank(value.rank) && isStamp(value.moved)
    case 'chat':
      return isText(value.name, MAX_NAME) && isId(value.id) && isText(value.text, MAX_CHAT) && value.text.trim().length > 0
    case 'playback':
      return isPlaybackWire(value.playback)
    case 'ping':
    case 'pong':
      return isId(value.to) && isNumberIn(value.t0, 0, Number.MAX_SAFE_INTEGER)
    case 'bye':
      return true
    default:
      return false
  }
}
