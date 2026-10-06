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

export type HttpGet = (url: string) => Promise<HttpResponse>

export interface ResolvedLink {
  metas: VideoMeta[]
  truncated: boolean
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_TEXT = 300

const defaultGet: HttpGet = url => fetch(url, {signal: AbortSignal.timeout(15_000)})

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: name => name === 'entry'
})

async function get(url: string, httpGet: HttpGet): Promise<HttpResponse> {
  try {
    return await httpGet(url)
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
  return {metas: metas.slice(0, PLAYLIST_LIMIT), truncated: metas.length >= PLAYLIST_LIMIT}
}

export async function resolveLink(input: string, httpGet: HttpGet = defaultGet): Promise<ResolvedLink> {
  const link = parseYouTubeLink(input)
  if (link === undefined) throw new ResolveError('invalid-link')
  if (link.kind === 'video') return {metas: [await fetchVideoMeta(link.videoId, httpGet)], truncated: false}
  return fetchPlaylist(link.listId, httpGet)
}
