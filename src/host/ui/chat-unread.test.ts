import {describe, expect, it} from 'vitest'
import type {ChatLine} from '../session'
import {unreadSince} from './chat-unread'

const line = (key: number, mine = false, kind: ChatLine['kind'] = 'message'): ChatLine => ({
  key,
  id: String(key),
  kind,
  from: mine ? 'me' : 'x',
  name: 'X',
  text: 't',
  at: 0,
  mine
})

describe('unreadSince', () => {
  it('counts the messages from others after the last seen line', () => {
    const lines = [line(1), line(2, true), line(3), line(4, false, 'joined'), line(5)]
    expect(unreadSince(lines, 2)).toBe(2)
    expect(unreadSince(lines, 5)).toBe(0)
    expect(unreadSince(lines, undefined)).toBe(3)
  })

  it('counts everything when the seen line was trimmed away by the 200 cap', () => {
    const lines = [line(201), line(202)]
    expect(unreadSince(lines, 7)).toBe(2)
  })
})
