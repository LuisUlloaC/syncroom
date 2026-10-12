import {describe, expect, it} from 'vitest'
import {SEARCH_LIMIT, searchVideos} from './search'
import {ResolveError, type HttpGet, type HttpInit} from './youtube'

const respond = (status: number, body: string): HttpGet => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
})

/** Un `videoRenderer` con la forma que devuelve hoy `youtubei/v1/search`. */
const video = (id: string, title: string, channel: string, length?: string, extra: Record<string, unknown> = {}): unknown => ({
  videoRenderer: {
    videoId: id,
    thumbnail: {thumbnails: [{url: `https://i.ytimg.com/vi/${id}/hq720.jpg`, width: 360, height: 202}]},
    title: {runs: [{text: title}], accessibility: {accessibilityData: {label: title}}},
    ownerText: {runs: [{text: channel, navigationEndpoint: {}}]},
    ...(length === undefined ? {} : {lengthText: {accessibility: {accessibilityData: {label: length}}, simpleText: length}}),
    ...extra
  }
})

const page = (items: unknown[]): string =>
  JSON.stringify({
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{itemSectionRenderer: {contents: items}}, {continuationItemRenderer: {trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN'}}]
          }
        }
      }
    }
  })

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (error) {
    return error instanceof ResolveError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('searchVideos', () => {
  it('asks the internal search endpoint for videos only', async () => {
    const calls: {url: string; init: HttpInit | undefined}[] = []
    const get: HttpGet = async (url, init) => {
      calls.push({url, init})
      return {ok: true, status: 200, text: async () => page([])}
    }
    await searchVideos('  bad bunny  ', get)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://www.youtube.com/youtubei/v1/search?prettyPrint=false')
    expect(calls[0]?.init?.method).toBe('POST')
    const body = JSON.parse(calls[0]?.init?.body ?? '{}') as Record<string, unknown>
    expect(body.query).toBe('bad bunny')
    // «Tipo: vídeo» del filtro de la web.
    expect(body.params).toBe('EgIQAQ%3D%3D')
    expect(body.context).toMatchObject({client: {clientName: 'WEB'}})
  })

  it('reads id, title, channel and duration, skipping channels and other renderers', async () => {
    const results = await searchVideos(
      'bad bunny',
      respond(
        200,
        page([
          {channelRenderer: {channelId: 'UC1'}},
          video('TmKh7lAwnBI', 'BAD BUNNY x JHAY CORTEZ - DÁKITI', 'Bad Bunny', '3:34'),
          {shelfRenderer: {}},
          video('wkuT_VJbUrc', 'BAD BUNNY MIX 2025', 'Kazi Smrity', '2:28:36')
        ])
      )
    )
    expect(results).toEqual([
      {videoId: 'TmKh7lAwnBI', title: 'BAD BUNNY x JHAY CORTEZ - DÁKITI', author: 'Bad Bunny', duration: '3:34'},
      {videoId: 'wkuT_VJbUrc', title: 'BAD BUNNY MIX 2025', author: 'Kazi Smrity', duration: '2:28:36'}
    ])
  })

  it('gives live streams no duration and leaves out premieres that have not started', async () => {
    const results = await searchVideos(
      'lofi',
      respond(
        200,
        page([
          video('rFZHOHl-L8A', 'lofi hip hop radio', 'Lofi Girl'),
          video('aaaaaaaaaaa', 'Premiere', 'Someone', undefined, {upcomingEventData: {startTime: '1790000000'}})
        ])
      )
    )
    expect(results).toEqual([{videoId: 'rFZHOHl-L8A', title: 'lofi hip hop radio', author: 'Lofi Girl', duration: null}])
  })

  it('drops invalid ids and duplicates, and keeps at most the limit', async () => {
    const many = Array.from({length: SEARCH_LIMIT + 5}, (_, i) => video(`video${String(i).padStart(6, '0')}`, `Song ${i}`, 'Band', '1:00'))
    const results = await searchVideos('x', respond(200, page([video('bad id', 'Nope', 'X', '1:00'), many[0], ...many])))
    expect(results).toHaveLength(SEARCH_LIMIT)
    expect(new Set(results.map(r => r.videoId)).size).toBe(SEARCH_LIMIT)
    expect(results[0]?.videoId).toBe('video000000')
  })

  it('returns an empty list when YouTube finds nothing', async () => {
    expect(await searchVideos('zzqxjv', respond(200, page([])))).toEqual([])
  })

  it('searches nothing for blank text', async () => {
    let called = false
    const get: HttpGet = async () => {
      called = true
      return {ok: true, status: 200, text: async () => page([])}
    }
    expect(await searchVideos('   ', get)).toEqual([])
    expect(called).toBe(false)
  })

  it('reports search-unavailable when the answer changes shape, and network when YouTube cannot be reached', async () => {
    expect(await codeOf(searchVideos('x', respond(200, '{}')))).toBe('search-unavailable')
    expect(await codeOf(searchVideos('x', respond(200, '<html>not json')))).toBe('search-unavailable')
    expect(await codeOf(searchVideos('x', respond(400, 'Bad Request')))).toBe('search-unavailable')
    expect(await codeOf(searchVideos('x', respond(503, 'busy')))).toBe('network')
    const offline: HttpGet = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await codeOf(searchVideos('x', offline))).toBe('network')
  })
})
