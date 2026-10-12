import {ResolveError, VIDEO_ID, asRecord, defaultGet, postYoutubei, text, type HttpGet} from './youtube'

/** Resultados que se enseñan por búsqueda: sin paginar. */
export const SEARCH_LIMIT = 10
export const MAX_QUERY = 200

/** «Tipo: vídeo» del filtro de la web de YouTube (sin canales, listas ni Shorts sueltos). */
const ONLY_VIDEOS = 'EgIQAQ%3D%3D'

export interface SearchResult {
  videoId: string
  title: string
  author: string
  /** Como la escribe YouTube («3:34», «2:28:36»); null = directo. */
  duration: string | null
}

/**
 * Busca vídeos por el endpoint interno de la web de YouTube, como `fetchMix` (sin clave ni cuota).
 * No es un API público: si cambia la forma de la respuesta, se lanza `search-unavailable` y pegar
 * enlaces sigue funcionando.
 */
export async function searchVideos(query: string, httpGet: HttpGet = defaultGet): Promise<SearchResult[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY)
  if (trimmed === '') return []
  const data = await postYoutubei('search', {query: trimmed, params: ONLY_VIDEOS}, 'search-unavailable', httpGet)
  const primary = asRecord(asRecord(asRecord(data).contents).twoColumnSearchResultsRenderer).primaryContents
  const sections = asRecord(asRecord(primary).sectionListRenderer).contents
  if (!Array.isArray(sections)) throw new ResolveError('search-unavailable')
  const results: SearchResult[] = []
  for (const section of sections) {
    const items = asRecord(asRecord(section).itemSectionRenderer).contents
    for (const raw of Array.isArray(items) ? items : []) {
      const item = asRecord(asRecord(raw).videoRenderer)
      const id = item.videoId
      // Estrenos que aún no empiezan: no se pueden reproducir.
      if (typeof id !== 'string' || !VIDEO_ID.test(id) || item.upcomingEventData !== undefined) continue
      if (results.some(result => result.videoId === id)) continue
      const runs = asRecord(item.title).runs
      const owner = asRecord(item.ownerText).runs
      const length = asRecord(item.lengthText).simpleText
      results.push({
        videoId: id,
        title: text(Array.isArray(runs) ? asRecord(runs[0]).text : undefined, id),
        author: text(Array.isArray(owner) ? asRecord(owner[0]).text : undefined, ''),
        duration: typeof length === 'string' && length.trim() !== '' ? length.trim() : null
      })
      if (results.length === SEARCH_LIMIT) return results
    }
  }
  return results
}
