import {describe, expect, it} from 'vitest'
import {PLAYLIST_LIMIT, ResolveError, fetchPlaylist, fetchVideoMeta, resolveLink, type HttpGet} from './youtube'

const respond = (status: number, body: string): HttpGet => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
})

const OEMBED = JSON.stringify({
  title: 'YouTube Developers Live: Embedded Web Player Customization',
  author_name: 'Google for Developers',
  type: 'video',
  provider_name: 'YouTube'
})

const entry = (id: string, title: string, author: string): string => `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>UC123</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
    <author><name>${author}</name><uri>https://www.youtube.com/channel/UC123</uri></author>
    <published>2024-10-18T04:00:06+00:00</published>
  </entry>`

const feed = (entries: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <id>yt:playlist:PLx</id>
  <title>My playlist</title>
  <author><name>Owner</name></author>
  ${entries.join('\n')}
</feed>`

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (error) {
    return error instanceof ResolveError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('fetchVideoMeta', () => {
  it('reads title and author from oEmbed', async () => {
    const urls: string[] = []
    const get: HttpGet = async url => {
      urls.push(url)
      return {ok: true, status: 200, text: async () => OEMBED}
    }
    expect(await fetchVideoMeta('M7lc1UVf-VE', get)).toEqual({
      videoId: 'M7lc1UVf-VE',
      title: 'YouTube Developers Live: Embedded Web Player Customization',
      author: 'Google for Developers'
    })
    expect(urls).toEqual([
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DM7lc1UVf-VE'
    ])
  })

  it('falls back to the id when the title is missing', async () => {
    expect(await fetchVideoMeta('M7lc1UVf-VE', respond(200, '{}'))).toEqual({
      videoId: 'M7lc1UVf-VE',
      title: 'M7lc1UVf-VE',
      author: ''
    })
  })

  it('maps failures to error codes', async () => {
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(404, 'Not Found')))).toBe('not-found')
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(400, 'Bad Request')))).toBe('not-found')
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(401, 'Unauthorized')))).toBe('not-embeddable')
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(403, 'Forbidden')))).toBe('not-embeddable')
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(503, 'busy')))).toBe('network')
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', respond(200, '<html>not json')))).toBe('network')
    const offline: HttpGet = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await codeOf(fetchVideoMeta('M7lc1UVf-VE', offline))).toBe('network')
  })
})

describe('fetchPlaylist', () => {
  it('reads entries in order, decoding entities and keeping numeric titles as text', async () => {
    const xml = feed([entry('M7lc1UVf-VE', 'ROSÉ &amp; Bruno Mars - APT.', 'ROSÉ'), entry('jNQXAC9IVRw', '1999', 'Prince')])
    expect(await fetchPlaylist('PLx1234567890', respond(200, xml))).toEqual({
      metas: [
        {videoId: 'M7lc1UVf-VE', title: 'ROSÉ & Bruno Mars - APT.', author: 'ROSÉ'},
        {videoId: 'jNQXAC9IVRw', title: '1999', author: 'Prince'}
      ],
      truncated: false,
      startIndex: 0
    })
  })

  it('handles a playlist with a single entry', async () => {
    const result = await fetchPlaylist('PLx1234567890', respond(200, feed([entry('M7lc1UVf-VE', 'Only one', 'Solo')])))
    expect(result.metas).toHaveLength(1)
  })

  it('flags playlists that hit the feed limit', async () => {
    const entries = Array.from({length: PLAYLIST_LIMIT}, (_, i) => entry(`vid${String(i).padStart(8, '0')}`, `Song ${i}`, 'Artist'))
    const result = await fetchPlaylist('PLx1234567890', respond(200, feed(entries)))
    expect(result.metas).toHaveLength(PLAYLIST_LIMIT)
    expect(result.truncated).toBe(true)
  })

  it('skips entries without a valid video id', async () => {
    const xml = feed([entry('bad id!', 'Broken', 'X'), entry('M7lc1UVf-VE', 'Good', 'Y')])
    const result = await fetchPlaylist('PLx1234567890', respond(200, xml))
    expect(result.metas.map(m => m.videoId)).toEqual(['M7lc1UVf-VE'])
  })

  it('maps failures to error codes', async () => {
    expect(await codeOf(fetchPlaylist('PLx1234567890', respond(404, '')))).toBe('not-found')
    expect(await codeOf(fetchPlaylist('PLx1234567890', respond(500, '')))).toBe('network')
    expect(await codeOf(fetchPlaylist('PLx1234567890', respond(200, feed([]))))).toBe('not-found')
    expect(await codeOf(fetchPlaylist('PLx1234567890', respond(200, 'not xml at all')))).toBe('not-found')
  })
})

describe('resolveLink', () => {
  it('rejects text that is not a YouTube link without touching the network', async () => {
    let called = false
    const get: HttpGet = async () => {
      called = true
      return {ok: true, status: 200, text: async () => OEMBED}
    }
    expect(await codeOf(resolveLink('hola', get))).toBe('invalid-link')
    expect(called).toBe(false)
  })

  it('resolves a video link to one track', async () => {
    const result = await resolveLink('https://youtu.be/M7lc1UVf-VE', respond(200, OEMBED))
    expect(result.truncated).toBe(false)
    expect(result.metas.map(m => m.videoId)).toEqual(['M7lc1UVf-VE'])
  })

  it('resolves a playlist link through the feed', async () => {
    const urls: string[] = []
    const get: HttpGet = async url => {
      urls.push(url)
      return {ok: true, status: 200, text: async () => feed([entry('M7lc1UVf-VE', 'One', 'A')])}
    }
    const result = await resolveLink('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj', get)
    expect(result.metas).toHaveLength(1)
    expect(result.startIndex).toBe(0)
    expect(urls).toEqual(['https://www.youtube.com/feeds/videos.xml?playlist_id=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'])
  })

  const LIST = 'https://www.youtube.com/watch?v=M7lc1UVf-VE&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'
  const THREE = feed([entry('jNQXAC9IVRw', 'One', 'A'), entry('M7lc1UVf-VE', 'Two', 'A'), entry('dQw4w9WgXcQ', 'Three', 'A')])
  const byUrl =
    (routes: Record<string, [number, string]>): HttpGet =>
    async url => {
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
      if (hit === undefined) throw new Error(`unexpected request ${url}`)
      const [status, body] = hit[1]
      return {ok: status < 300, status, text: async () => body}
    }

  it('loads the whole playlist from a watch link and starts at the pasted video', async () => {
    const result = await resolveLink(LIST, byUrl({'https://www.youtube.com/feeds/': [200, THREE]}))
    expect(result.metas.map(m => m.videoId)).toEqual(['jNQXAC9IVRw', 'M7lc1UVf-VE', 'dQw4w9WgXcQ'])
    expect(result.startIndex).toBe(1)
  })

  it('puts the pasted video first when the feed does not include it', async () => {
    const get = byUrl({
      'https://www.youtube.com/feeds/': [200, feed([entry('jNQXAC9IVRw', 'One', 'A')])],
      'https://www.youtube.com/oembed': [200, OEMBED]
    })
    const result = await resolveLink(LIST, get)
    expect(result.metas.map(m => m.videoId)).toEqual(['M7lc1UVf-VE', 'jNQXAC9IVRw'])
    expect(result.startIndex).toBe(0)
  })

  it('falls back to the single video when the list has no feed (mixes, private lists)', async () => {
    const get = byUrl({
      'https://www.youtube.com/feeds/': [404, 'Not Found'],
      'https://www.youtube.com/oembed': [200, OEMBED]
    })
    const result = await resolveLink('https://music.youtube.com/watch?v=M7lc1UVf-VE&list=RDAMVMM7lc1UVf-VE', get)
    expect(result.metas.map(m => m.videoId)).toEqual(['M7lc1UVf-VE'])
    expect(result.truncated).toBe(false)
  })

  it('still fails when a bare playlist link has no feed', async () => {
    const get = byUrl({'https://www.youtube.com/feeds/': [404, 'Not Found']})
    expect(await codeOf(resolveLink('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj', get))).toBe('not-found')
  })
})
