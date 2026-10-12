import {describe, expect, it} from 'vitest'
import {addIntent} from './add-box'

describe('addIntent', () => {
  it('adds YouTube links, with or without scheme', () => {
    expect(addIntent('https://youtu.be/M7lc1UVf-VE')).toEqual({kind: 'link'})
    expect(addIntent('  www.youtube.com/watch?v=M7lc1UVf-VE&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj ')).toEqual({kind: 'link'})
    expect(addIntent('music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj')).toEqual({kind: 'link'})
  })

  it('treats other addresses as links, so the host can say they are not from YouTube', () => {
    expect(addIntent('https://vimeo.com/123456')).toEqual({kind: 'link'})
    expect(addIntent('vimeo.com/123456')).toEqual({kind: 'link'})
  })

  it('searches anything else, trimmed', () => {
    expect(addIntent('  bad bunny dakiti ')).toEqual({kind: 'search', query: 'bad bunny dakiti'})
    expect(addIntent('Despacito')).toEqual({kind: 'search', query: 'Despacito'})
    expect(addIntent('AC/DC')).toEqual({kind: 'search', query: 'AC/DC'})
    expect(addIntent('Mr. Brightside')).toEqual({kind: 'search', query: 'Mr. Brightside'})
    expect(addIntent('youtube.com')).toEqual({kind: 'search', query: 'youtube.com'})
  })

  it('does nothing with blank text', () => {
    expect(addIntent('   ')).toEqual({kind: 'empty'})
  })
})
