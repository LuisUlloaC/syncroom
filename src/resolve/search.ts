import {LIST_ID} from './links'
import {ResolveError, VIDEO_ID, asRecord, defaultGet, postYoutubei, text, type HttpGet} from './youtube'

/** Resultados que se enseñan por búsqueda: sin paginar. */
export const SEARCH_LIMIT = 10
/** Listas que se mezclan con los vídeos de una búsqueda. */
export const PLAYLISTS_SHOWN = 3
export const MAX_QUERY = 200

/** «Tipo: vídeo» del filtro de la web de YouTube (sin canales, listas ni Shorts sueltos). */
const ONLY_VIDEOS = 'EgIQAQ%3D%3D'
/** «Tipo: lista» del mismo filtro. Sin filtro YouTube apenas devuelve listas (como mucho un Mix). */
const ONLY_PLAYLISTS = 'EgIQAw%3D%3D'

export interface VideoResult {
  kind: 'video'
  videoId: string
  title: string
  author: string
  /** Como la escribe YouTube («3:34», «2:28:36»); null = directo. */
  duration: string | null
}

export interface PlaylistResult {
  kind: 'playlist'
  listId: string
  /** El primer vídeo: su miniatura representa la lista y el enlace empieza por él. */
  videoId: string
  title: string
  author: string
  /** Número de vídeos; null si YouTube no lo dice (los Mix). */
  count: number | null
}

export type SearchResult = VideoResult | PlaylistResult

/**
 * Vídeos y listas: las dos búsquedas van en paralelo y las listas se intercalan entre los vídeos.
 * Sin listas (si su búsqueda falla) siguen saliendo los vídeos; si fallan los vídeos, falla todo.
 */
export async function search(query: string, httpGet: HttpGet = defaultGet): Promise<SearchResult[]> {
  const [videos, playlists] = await Promise.allSettled([searchVideos(query, httpGet), searchPlaylists(query, httpGet)])
  if (videos.status === 'rejected') throw videos.reason
  return interleave(videos.value, playlists.status === 'fulfilled' ? playlists.value.slice(0, PLAYLISTS_SHOWN) : [])
}

/** Una lista tras los dos primeros vídeos y luego cada tres, como hace la web; las que sobran, al final. */
function interleave(videos: VideoResult[], playlists: PlaylistResult[]): SearchResult[] {
  const out: SearchResult[] = []
  const pending = [...playlists]
  videos.forEach((video, i) => {
    out.push(video)
    if (i % 3 === 1) {
      const next = pending.shift()
      if (next !== undefined) out.push(next)
    }
  })
  return [...out, ...pending]
}

/**
 * Busca vídeos por el endpoint interno de la web de YouTube, como `fetchMix` (sin clave ni cuota).
 * No es un API público: si cambia la forma de la respuesta, se lanza `search-unavailable` y pegar
 * enlaces sigue funcionando.
 */
export async function searchVideos(query: string, httpGet: HttpGet = defaultGet): Promise<VideoResult[]> {
  const results: VideoResult[] = []
  for (const raw of await searchItems(query, ONLY_VIDEOS, httpGet)) {
    const item = asRecord(asRecord(raw).videoRenderer)
    const id = item.videoId
    // Estrenos que aún no empiezan: no se pueden reproducir.
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || item.upcomingEventData !== undefined) continue
    if (results.some(result => result.videoId === id)) continue
    const runs = asRecord(item.title).runs
    const owner = asRecord(item.ownerText).runs
    const length = asRecord(item.lengthText).simpleText
    results.push({
      kind: 'video',
      videoId: id,
      title: text(Array.isArray(runs) ? asRecord(runs[0]).text : undefined, id),
      author: text(Array.isArray(owner) ? asRecord(owner[0]).text : undefined, ''),
      duration: typeof length === 'string' && length.trim() !== '' ? length.trim() : null
    })
    if (results.length === SEARCH_LIMIT) break
  }
  return results
}

/** Listas por el mismo endpoint. Vienen como `lockupViewModel`, el formato nuevo de la web. */
export async function searchPlaylists(query: string, httpGet: HttpGet = defaultGet): Promise<PlaylistResult[]> {
  const results: PlaylistResult[] = []
  for (const raw of await searchItems(query, ONLY_PLAYLISTS, httpGet)) {
    const lockup = asRecord(asRecord(raw).lockupViewModel)
    const listId = lockup.contentId
    if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST' || typeof listId !== 'string' || !LIST_ID.test(listId)) continue
    const command = asRecord(asRecord(asRecord(lockup.rendererContext).commandContext).onTap).innertubeCommand
    const first = asRecord(asRecord(command).watchEndpoint).videoId
    if (typeof first !== 'string' || !VIDEO_ID.test(first)) continue
    if (results.some(result => result.listId === listId)) continue
    const meta = asRecord(asRecord(lockup.metadata).lockupMetadataViewModel)
    const rows = asRecord(asRecord(meta.metadata).contentMetadataViewModel).metadataRows
    const parts = Array.isArray(rows) ? asRecord(rows[0]).metadataParts : undefined
    results.push({
      kind: 'playlist',
      listId,
      videoId: first,
      title: text(asRecord(meta.title).content, listId),
      author: text(Array.isArray(parts) ? asRecord(asRecord(parts[0]).text).content : undefined, ''),
      count: videoCount(lockup)
    })
    if (results.length === SEARCH_LIMIT) break
  }
  return results
}

/** «32 videos» / «1,204 videos» de la insignia de la miniatura (la petición va con hl=en). */
function videoCount(lockup: Record<string, unknown>): number | null {
  const thumbnail = asRecord(asRecord(asRecord(lockup.contentImage).collectionThumbnailViewModel).primaryThumbnail)
  const overlays = asRecord(thumbnail.thumbnailViewModel).overlays
  for (const overlay of Array.isArray(overlays) ? overlays : []) {
    const badges = asRecord(asRecord(overlay).thumbnailOverlayBadgeViewModel).thumbnailBadges
    for (const badge of Array.isArray(badges) ? badges : []) {
      const label = asRecord(asRecord(badge).thumbnailBadgeViewModel).text
      const match = typeof label === 'string' ? /^([\d,.]+)\s+videos?$/i.exec(label.trim()) : null
      if (match !== null) return Number(match[1]?.replace(/[,.]/g, ''))
    }
  }
  return null
}

/** Los elementos de la primera página de resultados, con el filtro dado. */
async function searchItems(query: string, params: string, httpGet: HttpGet): Promise<unknown[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY)
  if (trimmed === '') return []
  const data = await postYoutubei('search', {query: trimmed, params}, 'search-unavailable', httpGet)
  const primary = asRecord(asRecord(asRecord(data).contents).twoColumnSearchResultsRenderer).primaryContents
  const sections = asRecord(asRecord(primary).sectionListRenderer).contents
  if (!Array.isArray(sections)) throw new ResolveError('search-unavailable')
  return sections.flatMap(section => {
    const items = asRecord(asRecord(section).itemSectionRenderer).contents
    return Array.isArray(items) ? items : []
  })
}
