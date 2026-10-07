import {describe, expect, it} from 'vitest'
import {parseYouTubeLink} from './links'

const video = (videoId: string) => ({kind: 'video', videoId})

describe('parseYouTubeLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://youtube.com/watch?v=M7lc1UVf-VE&t=30s', 'M7lc1UVf-VE'],
    ['https://m.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://music.youtube.com/watch?v=M7lc1UVf-VE&feature=share', 'M7lc1UVf-VE'],
    ['https://youtu.be/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://youtu.be/M7lc1UVf-VE?t=30', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/shorts/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/embed/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/live/M7lc1UVf-VE?feature=share', 'M7lc1UVf-VE'],
    ['http://www.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['youtu.be/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['  https://youtu.be/M7lc1UVf-VE  \n', 'M7lc1UVf-VE'],
    ['HTTPS://WWW.YOUTUBE.COM/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE']
  ])('reads the video from %s', (input, id) => {
    expect(parseYouTubeLink(input)).toEqual(video(id))
  })

  it('reads the playlist from watch and short links that carry a list, remembering the video', () => {
    const expected = {kind: 'playlist', listId: 'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj', videoId: 'M7lc1UVf-VE'}
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=M7lc1UVf-VE&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj&index=3')).toEqual(expected)
    expect(parseYouTubeLink('https://youtu.be/M7lc1UVf-VE?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')).toEqual(expected)
    expect(parseYouTubeLink('https://music.youtube.com/watch?v=M7lc1UVf-VE&list=RDAMVMM7lc1UVf-VE')).toEqual({
      ...expected,
      listId: 'RDAMVMM7lc1UVf-VE'
    })
  })

  it('ignores a malformed list on a watch link and keeps the video', () => {
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=M7lc1UVf-VE&list=x')).toEqual(video('M7lc1UVf-VE'))
  })

  it('reads playlists', () => {
    expect(parseYouTubeLink('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')).toEqual({
      kind: 'playlist',
      listId: 'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'
    })
    expect(parseYouTubeLink('music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')).toEqual({
      kind: 'playlist',
      listId: 'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'
    })
  })

  it.each([
    [''],
    ['   '],
    ['hola que tal'],
    ['M7lc1UVf-VE'],
    ['https://vimeo.com/123456'],
    ['https://youtube.com.evil.example/watch?v=M7lc1UVf-VE'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE<script>'],
    ['https://www.youtube.com/playlist'],
    ['https://www.youtube.com/playlist?list=x'],
    ['https://www.youtube.com/@GoogleDevelopers'],
    ['https://youtu.be/'],
    ['ftp://youtube.com/watch?v=M7lc1UVf-VE'],
    ['javascript:alert(1)'],
    ['https://youtu.be/M7lc1UVf-VE https://youtu.be/jNQXAC9IVRw']
  ])('rejects %j', input => {
    expect(parseYouTubeLink(input)).toBeUndefined()
  })
})
