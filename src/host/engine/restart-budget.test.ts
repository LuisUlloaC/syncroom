import {describe, expect, it} from 'vitest'
import {planRestart} from './restart-budget'

describe('planRestart', () => {
  it('restarts up to 3 times in a minute, numbering each real restart', () => {
    let history: readonly number[] = []
    const messages: string[] = []
    for (const now of [1000, 2000, 3000]) {
      const plan = planRestart(history, now)
      expect(plan.restart).toBe(true)
      messages.push(plan.message)
      history = plan.history
    }
    expect(messages).toEqual(['engine trouble: restart 1/3', 'engine trouble: restart 2/3', 'engine trouble: restart 3/3'])
    expect(history).toEqual([1000, 2000, 3000])
  })

  it('gives up on the 4th trouble instead of logging "restart 4/3"', () => {
    const plan = planRestart([1000, 2000, 3000], 4000)
    expect(plan).toEqual({restart: false, history: [1000, 2000, 3000], message: 'engine trouble: giving up after 3 restarts'})
  })

  it('forgets restarts older than a minute', () => {
    const plan = planRestart([1000, 2000, 3000], 62_500)
    expect(plan).toEqual({restart: true, history: [3000, 62_500], message: 'engine trouble: restart 2/3'})
  })
})
