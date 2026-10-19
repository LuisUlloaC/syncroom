import {describe, expect, it} from 'vitest'
import {SEARCH_LIMIT, search, searchPlaylists, searchVideos} from './search'
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
      {kind: 'video', videoId: 'TmKh7lAwnBI', title: 'BAD BUNNY x JHAY CORTEZ - DÁKITI', author: 'Bad Bunny', duration: '3:34'},
      {kind: 'video', videoId: 'wkuT_VJbUrc', title: 'BAD BUNNY MIX 2025', author: 'Kazi Smrity', duration: '2:28:36'}
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
    expect(results).toEqual([{kind: 'video', videoId: 'rFZHOHl-L8A', title: 'lofi hip hop radio', author: 'Lofi Girl', duration: null}])
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

/** Un `lockupViewModel` de lista con la forma que devuelve hoy la búsqueda filtrada por listas. */
const playlist = (listId: string, firstVideo: string, title: string, owner: string, badge: string, contentType = 'LOCKUP_CONTENT_TYPE_PLAYLIST'): unknown => ({
  lockupViewModel: {
    contentImage: {
      collectionThumbnailViewModel: {
        primaryThumbnail: {
          thumbnailViewModel: {
            image: {sources: [{url: `https://i.ytimg.com/vi/${firstVideo}/hqdefault.jpg`}]},
            overlays: [
              {thumbnailOverlayBadgeViewModel: {thumbnailBadges: [{thumbnailBadgeViewModel: {icon: {}, text: badge}}]}},
              {thumbnailHoverOverlayViewModel: {text: {content: 'Play all'}}}
            ]
          }
        }
      }
    },
    metadata: {
      lockupMetadataViewModel: {
        title: {content: title},
        metadata: {contentMetadataViewModel: {metadataRows: [{metadataParts: [{text: {content: owner}}, {text: {content: 'Playlist'}}]}]}}
      }
    },
    contentId: listId,
    contentType,
    rendererContext: {commandContext: {onTap: {innertubeCommand: {watchEndpoint: {videoId: firstVideo, playlistId: listId}}}}}
  }
})

describe('searchPlaylists', () => {
  it('asks for playlists only and reads id, first video, title, owner and size', async () => {
    let body: Record<string, unknown> = {}
    const get: HttpGet = async (_url, init) => {
      body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        text: async () =>
          page([
            playlist('PLar0gUcrS11h5SV8Eskz7s8NEL7Rn35tt', 'vXtJkDHEAAc', 'Calle 13. Mejores canciones', 'Planeta Musik', '32 videos'),
            playlist('PLbig000000000000', 'TmKh7lAwnBI', 'Huge', 'Someone', '1,204 videos'),
            playlist('RDEMAwkGY9PRZjwjNZSPiC', 'vXtJkDHEAAc', 'Mix - Calle 13', 'Calle 13 and more', 'Mix')
          ])
      }
    }
    const results = await searchPlaylists('calle 13', get)
    // «Tipo: lista» del filtro de la web.
    expect(body.params).toBe('EgIQAw%3D%3D')
    expect(results).toEqual([
      {kind: 'playlist', listId: 'PLar0gUcrS11h5SV8Eskz7s8NEL7Rn35tt', videoId: 'vXtJkDHEAAc', title: 'Calle 13. Mejores canciones', author: 'Planeta Musik', count: 32},
      {kind: 'playlist', listId: 'PLbig000000000000', videoId: 'TmKh7lAwnBI', title: 'Huge', author: 'Someone', count: 1204},
      {kind: 'playlist', listId: 'RDEMAwkGY9PRZjwjNZSPiC', videoId: 'vXtJkDHEAAc', title: 'Mix - Calle 13', author: 'Calle 13 and more', count: null}
    ])
  })

  it('skips lockups that are not playlists or lack a valid list or first video', async () => {
    const results = await searchPlaylists(
      'x',
      respond(
        200,
        page([
          playlist('PLchannel00000000', 'vXtJkDHEAAc', 'Not a list', 'X', '3 videos', 'LOCKUP_CONTENT_TYPE_VIDEO'),
          playlist('bad', 'vXtJkDHEAAc', 'Short id', 'X', '3 videos'),
          playlist('PLnovideo00000000', 'nope', 'No first video', 'X', '3 videos'),
          video('TmKh7lAwnBI', 'A video', 'Band', '3:00'),
          playlist('PLgood00000000000', 'TmKh7lAwnBI', 'Good', 'X', '3 videos')
        ])
      )
    )
    expect(results.map(r => r.listId)).toEqual(['PLgood00000000000'])
  })
})

describe('search (videos and playlists together)', () => {
  const videos = Array.from({length: SEARCH_LIMIT}, (_, i) => video(`video${String(i).padStart(6, '0')}`, `Song ${i}`, 'Band', '1:00'))
  const lists = Array.from({length: 5}, (_, i) => playlist(`PLlist${String(i).padStart(11, '0')}`, 'TmKh7lAwnBI', `List ${i}`, 'X', '9 videos'))
  const byFilter = (videoPage: () => string, listPage: () => string): HttpGet => async (_url, init) => {
    const params = (JSON.parse(init?.body ?? '{}') as {params?: string}).params
    return {ok: true, status: 200, text: async () => (params === 'EgIQAw%3D%3D' ? listPage() : videoPage())}
  }
  const shape = (results: Awaited<ReturnType<typeof search>>): string =>
    results.map(r => (r.kind === 'video' ? 'v' : 'P')).join('')

  it('mixes up to three playlists among the videos', async () => {
    const results = await search('x', byFilter(() => page(videos), () => page(lists)))
    expect(shape(results)).toBe('vvPvvvPvvvPvv')
    expect(results.filter(r => r.kind === 'playlist').map(r => r.title)).toEqual(['List 0', 'List 1', 'List 2'])
  })

  it('puts the playlists after the videos when there are few videos', async () => {
    expect(shape(await search('x', byFilter(() => page(videos.slice(0, 1)), () => page(lists.slice(0, 2)))))).toBe('vPP')
  })

  it('still shows the videos when the playlist search fails', async () => {
    const results = await search(
      'x',
      byFilter(
        () => page(videos.slice(0, 2)),
        () => '{}'
      )
    )
    expect(shape(results)).toBe('vv')
  })

  it('fails as before when the video search fails', async () => {
    expect(await codeOf(search('x', byFilter(() => '{}', () => page(lists))))).toBe('search-unavailable')
  })
})
