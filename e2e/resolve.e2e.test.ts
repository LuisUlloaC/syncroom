import {describe, expect, it} from 'vitest'
import {PLAYLIST_LIMIT, resolveLink} from '../src/resolve/youtube'

describe('resolve against the real YouTube', () => {
  it('resolves a video through oEmbed', async () => {
    const result = await resolveLink('https://youtu.be/M7lc1UVf-VE')
    expect(result.truncated).toBe(false)
    expect(result.metas).toHaveLength(1)
    expect(result.metas[0]?.title.length).toBeGreaterThan(3)
    expect(result.metas[0]?.author.length).toBeGreaterThan(1)
  })

  it('resolves a playlist through the public feed', async () => {
    const result = await resolveLink('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')
    expect(result.metas.length).toBeGreaterThan(1)
    expect(result.metas.length).toBeLessThanOrEqual(PLAYLIST_LIMIT)
    for (const meta of result.metas) expect(meta.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/)
  })

  it('loads the whole playlist from a watch link with list=', async () => {
    const list = await resolveLink('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')
    const second = list.metas[1]
    if (second === undefined) throw new Error('the test playlist needs at least two videos')
    const result = await resolveLink(
      `https://www.youtube.com/watch?v=${second.videoId}&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj&index=2`
    )
    expect(result.metas.map(m => m.videoId)).toEqual(list.metas.map(m => m.videoId))
    expect(result.startIndex).toBe(1)
  })
})
