import {XMLParser} from 'fast-xml-parser'
import type {VideoMeta} from '../core/types'
import {parseYouTubeLink} from './links'

/** El feed RSS público de YouTube solo devuelve los primeros 15 vídeos de una playlist. */
export const PLAYLIST_LIMIT = 15

export type ResolveErrorCode = 'invalid-link' | 'not-found' | 'not-embeddable' | 'network'

export class ResolveError extends Error {
  constructor(readonly code: ResolveErrorCode) {
    super(code)
    this.name = 'ResolveError'
  }
}

export interface HttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export interface HttpInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
}

/** GET si no hay `init`; con él, la petición que describe. */
export type HttpGet = (url: string, init?: HttpInit) => Promise<HttpResponse>

export interface ResolvedLink {
  metas: VideoMeta[]
  truncated: boolean
  /** Pista por la que empezar si la sala estaba vacía. */
  startIndex: number
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_TEXT = 300

const defaultGet: HttpGet = (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(15_000)})

/** Los Mixes (list=RD…) los genera YouTube al vuelo: no tienen feed ni salen en el API oficial. */
export const isMix = (listId: string): boolean => listId.startsWith('RD')
/** Un Mix no termina; el primer bloque que da YouTube son unos 25 vídeos. */
export const MIX_LIMIT = 50

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: name => name === 'entry'
})

async function get(url: string, httpGet: HttpGet, init?: HttpInit): Promise<HttpResponse> {
  try {
    return await httpGet(url, init)
  } catch {
    throw new ResolveError('network')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : fallback
}

export async function fetchVideoMeta(videoId: string, httpGet: HttpGet = defaultGet): Promise<VideoMeta> {
  const watch = `https://www.youtube.com/watch?v=${videoId}`
  const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, httpGet)
  if (res.status === 401 || res.status === 403) throw new ResolveError('not-embeddable')
  if (!res.ok) throw new ResolveError(res.status >= 500 ? 'network' : 'not-found')
  let data: unknown
  try {
    data = JSON.parse(await res.text())
  } catch {
    throw new ResolveError('network')
  }
  const record = asRecord(data)
  return {videoId, title: text(record.title, videoId), author: text(record.author_name, '')}
}

export async function fetchPlaylist(listId: string, httpGet: HttpGet = defaultGet): Promise<ResolvedLink> {
  const res = await get(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(listId)}`, httpGet)
  if (!res.ok) throw new ResolveError(res.status >= 500 ? 'network' : 'not-found')
  let doc: unknown
  try {
    doc = parser.parse(await res.text())
  } catch {
    throw new ResolveError('not-found')
  }
  const entries = asRecord(asRecord(doc).feed).entry
  const metas: VideoMeta[] = []
  for (const raw of Array.isArray(entries) ? entries : []) {
    const item = asRecord(raw)
    const videoId = item['yt:videoId']
    if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) continue
    metas.push({videoId, title: text(item.title, videoId), author: text(asRecord(item.author).name, '')})
  }
  if (metas.length === 0) throw new ResolveError('not-found')
  return {metas: metas.slice(0, PLAYLIST_LIMIT), truncated: metas.length >= PLAYLIST_LIMIT, startIndex: 0}
}

/**
 * Contenido de un Mix por el mismo endpoint interno que usa la web de YouTube (sin clave ni cuenta).
 * No es un API público: si cambia la forma de la respuesta, se lanza `not-found` y quien llama
 * se queda con el vídeo suelto. El Mix anónimo se parece al del usuario, pero no es idéntico.
 */
export async function fetchMix(listId: string, videoId: string, httpGet: HttpGet = defaultGet): Promise<ResolvedLink> {
  const res = await get('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', httpGet, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      context: {client: {clientName: 'WEB', clientVersion: '2.20251001.00.00', hl: 'en'}},
      videoId,
      playlistId: listId
    })
  })
  if (!res.ok) throw new ResolveError(res.status >= 500 ? 'network' : 'not-found')
  let data: unknown
  try {
    data = JSON.parse(await res.text())
  } catch {
    throw new ResolveError('not-found')
  }
  const results = asRecord(asRecord(asRecord(data).contents).twoColumnWatchNextResults)
  const playlist = asRecord(asRecord(results.playlist).playlist)
  const metas: VideoMeta[] = []
  for (const raw of Array.isArray(playlist.contents) ? playlist.contents : []) {
    const item = asRecord(asRecord(raw).playlistPanelVideoRenderer)
    const id = item.videoId
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || metas.some(meta => meta.videoId === id)) continue
    const runs = asRecord(item.shortBylineText).runs
    const author = Array.isArray(runs) ? asRecord(runs[0]).text : undefined
    metas.push({videoId: id, title: text(asRecord(item.title).simpleText, id), author: text(author, '')})
  }
  if (metas.length === 0) throw new ResolveError('not-found')
  return {metas: metas.slice(0, MIX_LIMIT), truncated: false, startIndex: 0}
}

async function resolveVideo(videoId: string, httpGet: HttpGet): Promise<ResolvedLink> {
  return {metas: [await fetchVideoMeta(videoId, httpGet)], truncated: false, startIndex: 0}
}

/**
 * Lista con vídeo (watch?v=…&list=…): toda la lista, empezando por ese vídeo. Si el feed no lo
 * trae (está más allá de los 15 primeros) se pone delante; si la lista no tiene feed (mixes,
 * listas privadas) queda el vídeo solo.
 */
async function resolvePlaylistAt(listId: string, videoId: string, httpGet: HttpGet): Promise<ResolvedLink> {
  let list: ResolvedLink
  try {
    list = await (isMix(listId) ? fetchMix(listId, videoId, httpGet) : fetchPlaylist(listId, httpGet))
  } catch (error) {
    if (error instanceof ResolveError && error.code === 'not-found') return resolveVideo(videoId, httpGet)
    throw error
  }
  const index = list.metas.findIndex(meta => meta.videoId === videoId)
  if (index >= 0) return {...list, startIndex: index}
  const first = await fetchVideoMeta(videoId, httpGet)
  return {...list, metas: [first, ...list.metas], startIndex: 0}
}

export async function resolveLink(input: string, httpGet: HttpGet = defaultGet): Promise<ResolvedLink> {
  const link = parseYouTubeLink(input)
  if (link === undefined) throw new ResolveError('invalid-link')
  if (link.kind === 'video') return resolveVideo(link.videoId, httpGet)
  if (link.videoId !== undefined) return resolvePlaylistAt(link.listId, link.videoId, httpGet)
  return fetchPlaylist(link.listId, httpGet)
}
