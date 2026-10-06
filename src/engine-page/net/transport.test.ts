import {describe, expect, it, vi} from 'vitest'
import {Transport, type Path} from './transport'

class FakePath implements Path {
  sent: string[] = []
  closed = false
  onReceive: ((envelope: string) => void) | undefined
  send(envelope: string): void {
    this.sent.push(envelope)
  }
  close(): void {
    this.closed = true
  }
}

const envelope = (id: string, msg: unknown): string => JSON.stringify({id, msg})

function setup(withDirect = true) {
  const direct = withDirect ? new FakePath() : undefined
  const relay = new FakePath()
  const onMessage = vi.fn()
  const transport = new Transport(direct, relay, onMessage)
  return {direct, relay, onMessage, transport}
}

describe('Transport', () => {
  it('sends state changes through both paths with the same envelope', () => {
    const {direct, relay, transport} = setup()
    transport.send({type: 'bye', from: 'a'}, true)
    expect(direct?.sent).toHaveLength(1)
    expect(relay.sent).toEqual(direct?.sent)
    const parsed = JSON.parse(relay.sent[0] ?? '{}') as {id: string; msg: unknown}
    expect(parsed.msg).toEqual({type: 'bye', from: 'a'})
    expect(parsed.id.length).toBeGreaterThan(8)
  })

  it('keeps direct-only messages off the relays', () => {
    const {direct, relay, transport} = setup()
    transport.send({type: 'ping'}, false)
    expect(direct?.sent).toHaveLength(1)
    expect(relay.sent).toHaveLength(0)
  })

  it('drops direct-only messages when there is no direct path', () => {
    const {relay, transport} = setup(false)
    transport.send({type: 'ping'}, false)
    transport.send({type: 'bye'}, true)
    expect(relay.sent).toHaveLength(1)
  })

  it('delivers each message once, labelled with the path that arrived first', () => {
    const {direct, relay, onMessage} = setup()
    relay.onReceive?.(envelope('m1', {n: 1}))
    direct?.onReceive?.(envelope('m1', {n: 1}))
    direct?.onReceive?.(envelope('m2', {n: 2}))
    relay.onReceive?.(envelope('m2', {n: 2}))
    expect(onMessage.mock.calls).toEqual([
      [{n: 1}, 'relay'],
      [{n: 2}, 'direct']
    ])
  })

  it('ignores the echo of its own messages', () => {
    const {relay, onMessage, transport} = setup()
    transport.send({type: 'bye'}, true)
    relay.onReceive?.(relay.sent[0] ?? '')
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('ignores malformed envelopes', () => {
    const {relay, onMessage} = setup()
    relay.onReceive?.('not json')
    relay.onReceive?.('null')
    relay.onReceive?.('[]')
    relay.onReceive?.(JSON.stringify({msg: {n: 1}}))
    relay.onReceive?.(JSON.stringify({id: 42, msg: {n: 1}}))
    relay.onReceive?.(JSON.stringify({id: '', msg: {n: 1}}))
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('forgets old ids so memory stays bounded', () => {
    const {relay, onMessage} = setup()
    for (let i = 0; i <= 2000; i++) relay.onReceive?.(envelope(`m${i}`, i))
    onMessage.mockClear()
    relay.onReceive?.(envelope('m2000', 2000))
    expect(onMessage).not.toHaveBeenCalled()
    relay.onReceive?.(envelope('m0', 0))
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('closes both paths', () => {
    const {direct, relay, transport} = setup()
    transport.close()
    expect(direct?.closed).toBe(true)
    expect(relay.closed).toBe(true)
  })
})
