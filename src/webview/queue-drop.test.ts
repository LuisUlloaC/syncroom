import {describe, expect, it} from 'vitest'
import {dropPlacement} from './queue-drop'

const ids = ['a', 'b', 'c', 'd']

describe('dropPlacement', () => {
  it('computes the neighbours for a drop before or after a target', () => {
    expect(dropPlacement(ids, 'd', {id: 'a', side: 'before'})).toEqual({beforeId: null, afterId: 'a'})
    expect(dropPlacement(ids, 'd', {id: 'b', side: 'after'})).toEqual({beforeId: 'b', afterId: 'c'})
    expect(dropPlacement(ids, 'a', {id: 'd', side: 'after'})).toEqual({beforeId: 'd', afterId: null})
  })

  it('returns undefined when the drop would not move the track', () => {
    expect(dropPlacement(ids, 'b', {id: 'b', side: 'before'})).toBeUndefined()
    expect(dropPlacement(ids, 'b', {id: 'a', side: 'after'})).toBeUndefined()
    expect(dropPlacement(ids, 'b', {id: 'c', side: 'before'})).toBeUndefined()
    expect(dropPlacement(ids, 'a', {id: 'b', side: 'before'})).toBeUndefined()
    expect(dropPlacement(ids, 'd', {id: 'c', side: 'after'})).toBeUndefined()
  })

  it('ignores unknown ids', () => {
    expect(dropPlacement(ids, 'zz', {id: 'a', side: 'before'})).toBeUndefined()
    expect(dropPlacement(ids, 'a', {id: 'zz', side: 'before'})).toBeUndefined()
  })
})
