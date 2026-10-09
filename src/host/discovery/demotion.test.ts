import {describe, expect, it} from 'vitest'
import type {Listed} from '../../core/types'
import type {PolicyView} from '../session'
import {needsDemotion} from './demotion'

function view(listed: Listed, mine = true): {code: string; policy: PolicyView} {
  return {
    code: 'ABCD2345',
    policy: {ownerName: 'Luis', mine, lockQueue: true, lockPlayback: true, listed, canEditQueue: true, canControlPlayback: true}
  }
}

const has = (): boolean => true
const missing = (): boolean => false

describe('needsDemotion', () => {
  it('my room listed in a group whose word I no longer have goes private', () => {
    expect(needsDemotion(view('group'), missing)).toBe(true)
  })

  it('a public room stays as it is', () => {
    expect(needsDemotion(view('global'), missing)).toBe(false)
  })

  it('someone else’s room is not mine to change', () => {
    expect(needsDemotion(view('group', false), missing)).toBe(false)
  })

  it('a group room whose word I have stays listed', () => {
    expect(needsDemotion(view('group'), has)).toBe(false)
  })

  it('a private room or one without an owner needs nothing', () => {
    expect(needsDemotion(view('none'), missing)).toBe(false)
    expect(needsDemotion({code: 'ABCD2345', policy: undefined}, missing)).toBe(false)
  })

  it('asks about the room’s own code', () => {
    const asked: string[] = []
    needsDemotion(view('group'), code => (asked.push(code), true))
    expect(asked).toEqual(['ABCD2345'])
  })
})
