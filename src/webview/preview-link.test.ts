import {describe, expect, it} from 'vitest'
import type {HostToWebview, WebviewToHost} from '../protocol/webview'
import {PreviewLink} from './preview-link'

/** Descripción como las del navegador: lleva una función, así que structuredClone (postMessage) la rechaza. */
class FakeDescription {
  constructor(readonly type: RTCSdpType, readonly sdp: string) {}
  readonly toJSON = (): RTCSessionDescriptionInit => ({type: this.type, sdp: this.sdp})
}

class FakePc {
  closed = false
  ontrack: ((event: {streams: MediaStream[]}) => void) | null = null
  onicecandidate: ((event: {candidate: {toJSON(): RTCIceCandidateInit} | null}) => void) | null = null
  remote: RTCSessionDescriptionInit | undefined
  localDescription: FakeDescription | null = null
  added: RTCIceCandidateInit[] = []

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remote = description
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {type: 'answer', sdp: 'v=0 answer'}
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = new FakeDescription(description.type ?? 'answer', description.sdp ?? '')
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.added.push(candidate)
  }

  close(): void {
    this.closed = true
  }
}

function setup() {
  const posted: WebviewToHost[] = []
  const pcs: FakePc[] = []
  const streams: Array<MediaStream | null> = []
  const link = new PreviewLink(
    message => posted.push(message),
    () => {
      const pc = new FakePc()
      pcs.push(pc)
      return pc as unknown as RTCPeerConnection
    }
  )
  link.onStream = stream => streams.push(stream)
  return {link, posted, pcs, streams}
}

const offer = (sdp = 'v=0 offer'): HostToWebview => ({t: 'rtc', signal: {kind: 'offer', sdp}})
const ice: HostToWebview = {t: 'rtc', signal: {kind: 'ice', candidate: {candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0}}}

describe('PreviewLink', () => {
  it('answers an offer with plain data (kind and sdp string)', async () => {
    const {link, posted, pcs} = setup()
    await link.handle(offer())
    expect(pcs[0]?.remote).toEqual({type: 'offer', sdp: 'v=0 offer'})
    expect(posted).toStrictEqual([{t: 'rtc', signal: {kind: 'answer', sdp: 'v=0 answer'}}])
    expect(() => structuredClone(posted)).not.toThrow()
  })

  it('sends its ICE candidates serialized with toJSON', async () => {
    const {link, posted, pcs} = setup()
    await link.handle(offer())
    const json = {candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u'}
    pcs[0]?.onicecandidate?.({candidate: {toJSON: () => json}})
    pcs[0]?.onicecandidate?.({candidate: null})
    expect(posted.slice(1)).toStrictEqual([{t: 'rtc', signal: {kind: 'ice', candidate: json}}])
    expect(() => structuredClone(posted)).not.toThrow()
  })

  it('adds the engine candidates to the connection', async () => {
    const {link, pcs} = setup()
    await link.handle(offer())
    await link.handle(ice)
    expect(pcs[0]?.added).toEqual([{candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0}])
  })

  it('hands over the stream when the track arrives', async () => {
    const {link, pcs, streams} = setup()
    await link.handle(offer())
    const stream = {id: 's'} as unknown as MediaStream
    pcs[0]?.ontrack?.({streams: [stream]})
    expect(streams).toEqual([stream])
  })

  it('closes the previous connection when a new offer arrives', async () => {
    const {link, pcs} = setup()
    await link.handle(offer('first'))
    await link.handle(offer('second'))
    expect(pcs).toHaveLength(2)
    expect(pcs[0]?.closed).toBe(true)
    expect(pcs[1]?.closed).toBe(false)
    expect(pcs[1]?.remote?.sdp).toBe('second')
  })

  it('closes and clears the stream when the preview ends', async () => {
    const {link, pcs, streams} = setup()
    await link.handle(offer())
    await link.handle({t: 'previewEnd'})
    expect(pcs[0]?.closed).toBe(true)
    expect(streams.at(-1)).toBeNull()
  })

  it('ignores candidates that arrive before any offer', async () => {
    const {link, posted, pcs} = setup()
    await expect(link.handle(ice)).resolves.toBeUndefined()
    expect(pcs).toHaveLength(0)
    expect(posted).toEqual([])
  })
})
