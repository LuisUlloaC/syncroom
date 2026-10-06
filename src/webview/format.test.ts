import {describe, expect, it} from 'vitest'
import {clock, thumbnail} from './format'

describe('clock', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [59.9, '0:59'],
    [-3, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00']
  ])('formats %s seconds as %s', (seconds, text) => {
    expect(clock(seconds)).toBe(text)
  })
})

describe('thumbnail', () => {
  it('points at the YouTube image host', () => {
    expect(thumbnail('M7lc1UVf-VE')).toBe('https://i.ytimg.com/vi/M7lc1UVf-VE/mqdefault.jpg')
  })

  it('cannot be steered to another path', () => {
    expect(thumbnail('../../x')).toBe('https://i.ytimg.com/vi/..%2F..%2Fx/mqdefault.jpg')
  })
})
