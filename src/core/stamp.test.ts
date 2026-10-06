import {describe, expect, it} from 'vitest'
import {LamportClock, MAX_COUNTER, ZERO_STAMP, compareStamps} from './stamp'
import {fnv1a} from './hash'

describe('stamps', () => {
  it('orders by counter, then by peer id', () => {
    expect(compareStamps({counter: 1, peerId: 'b'}, {counter: 2, peerId: 'a'})).toBeLessThan(0)
    expect(compareStamps({counter: 2, peerId: 'a'}, {counter: 2, peerId: 'b'})).toBeLessThan(0)
    expect(compareStamps({counter: 2, peerId: 'b'}, {counter: 2, peerId: 'a'})).toBeGreaterThan(0)
    expect(compareStamps({counter: 2, peerId: 'a'}, {counter: 2, peerId: 'a'})).toBe(0)
  })

  it('any real stamp beats the zero stamp', () => {
    expect(compareStamps({counter: 1, peerId: ''}, ZERO_STAMP)).toBeGreaterThan(0)
  })

  it('ignores observed counters beyond the accepted range', () => {
    const clock = new LamportClock('a')
    clock.observe({counter: 2 ** 41, peerId: 'b'})
    expect(clock.tick().counter).toBe(1)
    clock.observe({counter: MAX_COUNTER, peerId: 'b'})
    expect(clock.tick().counter).toBe(2)
  })

  it('ticks monotonically and jumps past observed stamps', () => {
    const clock = new LamportClock('a')
    expect(clock.tick()).toEqual({counter: 1, peerId: 'a'})
    clock.observe({counter: 10, peerId: 'b'})
    expect(clock.tick()).toEqual({counter: 11, peerId: 'a'})
    clock.observe({counter: 3, peerId: 'b'})
    expect(clock.tick()).toEqual({counter: 12, peerId: 'a'})
  })
})

describe('fnv1a', () => {
  it('is stable and 8 hex characters', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(fnv1a('syncroom')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a('a|b')).not.toBe(fnv1a('b|a'))
  })
})
