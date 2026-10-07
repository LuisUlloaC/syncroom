import {fnv1a} from './hash'
import {LamportClock, ZERO_STAMP, compareStamps} from './stamp'
import {MAX_REMOVED} from './validate'
import type {Outgoing, Peer, PeerId, Playback, PlaybackWire, RoomMessage, Track, Via, VideoMeta} from './types'

export const RELAY_TRANSIT_MS = 250
export const DEFAULT_DIRECT_TRANSIT_MS = 50
export const STATE_REPLY_INTERVAL_MS = 3000
export const MAX_QUEUE = 500

export interface RoomStateOptions {
  peerId: PeerId
  name: string
  now: () => number
}

interface PeerInfo {
  name: string
  seenAt: number
}

export class RoomState {
  private readonly clock: LamportClock
  /** Incluye las pistas borradas: hacen falta para saber cuál venía después. */
  private readonly tracks = new Map<string, Track>()
  private readonly removed = new Set<string>()
  private readonly peers = new Map<PeerId, PeerInfo>()
  private readonly latency = new Map<PeerId, number>()
  private readonly listeners = new Set<() => void>()
  private playback: Playback
  private lastStateSentAt = Number.NEGATIVE_INFINITY

  constructor(private readonly opts: RoomStateOptions) {
    this.clock = new LamportClock(opts.peerId)
    this.playback = {trackId: null, playing: false, positionS: 0, anchorAt: opts.now(), stamp: ZERO_STAMP}
  }

  // ── Consultas ────────────────────────────────────────────────────────────

  get peerId(): PeerId {
    return this.opts.peerId
  }

  queue(): Track[] {
    return [...this.tracks.values()]
      .filter(track => !this.removed.has(track.id))
      .sort((a, b) => compareStamps(a.order, b.order))
  }

  currentTrack(): Track | undefined {
    const id = this.playback.trackId
    if (id === null || this.removed.has(id)) return undefined
    return this.tracks.get(id)
  }

  getPlayback(): Playback {
    return this.playback
  }

  expectedPosition(): number {
    const p = this.playback
    return p.playing ? p.positionS + (this.opts.now() - p.anchorAt) / 1000 : p.positionS
  }

  peerList(): Peer[] {
    const others = [...this.peers.entries()]
      .map(([id, info]) => ({id, name: info.name}))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    return [{id: this.opts.peerId, name: this.opts.name}, ...others]
  }

  digest(): string {
    const live = this.queue()
      .map(track => track.id)
      .sort()
      .join(',')
    const gone = [...this.removed].sort().join(',')
    const stamp = this.playback.stamp
    return fnv1a(`${live}|${gone}|${stamp.counter}:${stamp.peerId}`)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ── Acciones locales ─────────────────────────────────────────────────────

  join(): Outgoing[] {
    return [this.hello(true)]
  }

  heartbeat(relay: boolean): Outgoing[] {
    return [this.hello(relay)]
  }

  pings(): Outgoing[] {
    const t0 = this.opts.now()
    return [...this.peers.keys()].map(
      (to): Outgoing => ({msg: {type: 'ping', from: this.opts.peerId, to, t0}, relay: false})
    )
  }

  leave(): Outgoing[] {
    return [{msg: {type: 'bye', from: this.opts.peerId}, relay: true}]
  }

  /** `startIndex`: cuál suena primero si la sala estaba parada (por defecto, la primera añadida). */
  addTracks(metas: VideoMeta[], startIndex = 0): Outgoing[] {
    const room = Math.max(0, MAX_QUEUE - this.queue().length)
    const added: Track[] = []
    for (const meta of metas.slice(0, room)) {
      const order = this.clock.tick()
      const track: Track = {
        id: `${order.peerId}:${order.counter}`,
        videoId: meta.videoId,
        title: meta.title,
        author: meta.author,
        addedBy: this.opts.name,
        order
      }
      this.tracks.set(track.id, track)
      added.push(track)
    }
    const first = added[startIndex] ?? added[0]
    if (first === undefined) return []
    const out: Outgoing[] = [{msg: {type: 'add', from: this.opts.peerId, tracks: added}, relay: true}]
    if (this.currentTrack() === undefined) out.push(...this.writePlayback(first.id, true, 0))
    else this.emit()
    return out
  }

  removeTrack(trackId: string): Outgoing[] {
    if (!this.tracks.has(trackId) || this.removed.has(trackId)) return []
    this.removed.add(trackId)
    const out: Outgoing[] = [{msg: {type: 'remove', from: this.opts.peerId, trackId}, relay: true}]
    const healed = this.healPlayback()
    if (healed.length === 0) this.emit()
    return [...out, ...healed]
  }

  setPlaying(playing: boolean): Outgoing[] {
    const current = this.currentTrack()
    if (current === undefined) {
      const first = this.queue()[0]
      return playing && first !== undefined ? this.writePlayback(first.id, true, 0) : []
    }
    return this.writePlayback(current.id, playing, this.expectedPosition())
  }

  seek(positionS: number): Outgoing[] {
    const current = this.currentTrack()
    if (current === undefined) return []
    return this.writePlayback(current.id, this.playback.playing, Math.max(0, positionS))
  }

  playTrack(trackId: string): Outgoing[] {
    if (!this.tracks.has(trackId) || this.removed.has(trackId)) return []
    return this.writePlayback(trackId, true, 0)
  }

  next(): Outgoing[] {
    const id = this.playback.trackId
    const following = id === null ? this.queue()[0] : this.nextAfter(id)
    return this.writePlayback(following?.id ?? null, following !== undefined, 0)
  }

  trackEnded(trackId: string): Outgoing[] {
    if (this.playback.trackId !== trackId) return []
    return this.next()
  }

  expirePeers(maxAgeMs: number): void {
    const now = this.opts.now()
    let changed = false
    for (const [id, info] of this.peers) {
      if (now - info.seenAt > maxAgeMs) {
        this.peers.delete(id)
        this.latency.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  // ── Mensajes remotos ─────────────────────────────────────────────────────

  receive(msg: RoomMessage, via: Via): Outgoing[] {
    if (msg.from === this.opts.peerId) return []
    const now = this.opts.now()
    const known = this.peers.get(msg.from)
    const isNew = known === undefined
    if (msg.type !== 'bye') this.peers.set(msg.from, {name: known?.name ?? '', seenAt: now})
    const out: Outgoing[] = []

    switch (msg.type) {
      case 'hello': {
        this.peers.set(msg.from, {name: msg.name, seenAt: now})
        const differs = msg.digest !== this.digest()
        if (isNew || (differs && now - this.lastStateSentAt >= STATE_REPLY_INTERVAL_MS)) {
          this.lastStateSentAt = now
          out.push({msg: this.stateMessage(), relay: true})
        }
        break
      }
      case 'state':
        this.peers.set(msg.from, {name: msg.name, seenAt: now})
        this.mergeTracks(msg.tracks)
        for (const id of msg.removed) this.tombstone(id)
        this.applyPlayback(msg.playback, this.transit(msg.from, via))
        break
      case 'add':
        this.mergeTracks(msg.tracks)
        break
      case 'remove':
        this.tombstone(msg.trackId)
        break
      case 'playback':
        this.applyPlayback(msg.playback, this.transit(msg.from, via))
        break
      case 'ping':
        if (msg.to === this.opts.peerId) {
          out.push({msg: {type: 'pong', from: this.opts.peerId, to: msg.from, t0: msg.t0}, relay: false})
        }
        if (isNew) this.emit()
        return out
      case 'pong': {
        const half = (now - msg.t0) / 2
        if (msg.to === this.opts.peerId && half >= 0) {
          const previous = this.latency.get(msg.from)
          this.latency.set(msg.from, previous === undefined ? half : previous * 0.7 + half * 0.3)
        }
        if (isNew) this.emit()
        return out
      }
      case 'bye':
        this.peers.delete(msg.from)
        this.latency.delete(msg.from)
        break
    }

    const healed = this.healPlayback()
    if (healed.length === 0) this.emit()
    return [...out, ...healed]
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private hello(relay: boolean): Outgoing {
    return {
      msg: {type: 'hello', from: this.opts.peerId, name: this.opts.name, digest: this.digest()},
      relay
    }
  }

  private stateMessage(): RoomMessage {
    return {
      type: 'state',
      from: this.opts.peerId,
      name: this.opts.name,
      tracks: this.queue(),
      removed: [...this.removed].slice(0, MAX_REMOVED),
      playback: this.toWire()
    }
  }

  private toWire(): PlaybackWire {
    const p = this.playback
    return {
      trackId: p.trackId,
      playing: p.playing,
      positionS: p.positionS,
      ageMs: p.playing ? Math.max(0, this.opts.now() - p.anchorAt) : 0,
      stamp: p.stamp
    }
  }

  private writePlayback(trackId: string | null, playing: boolean, positionS: number): Outgoing[] {
    this.playback = {trackId, playing, positionS, anchorAt: this.opts.now(), stamp: this.clock.tick()}
    this.emit()
    return [{msg: {type: 'playback', from: this.opts.peerId, playback: this.toWire()}, relay: true}]
  }

  private applyPlayback(wire: PlaybackWire, transitMs: number): void {
    this.clock.observe(wire.stamp)
    if (compareStamps(wire.stamp, this.playback.stamp) <= 0) return
    this.playback = {
      trackId: wire.trackId,
      playing: wire.playing,
      positionS: wire.positionS,
      anchorAt: this.opts.now() - (wire.playing ? wire.ageMs + transitMs : 0),
      stamp: {counter: wire.stamp.counter, peerId: wire.stamp.peerId}
    }
  }

  private mergeTracks(incoming: Track[]): void {
    let live = this.queue().length
    for (const track of incoming) {
      this.clock.observe(track.order)
      if (this.tracks.has(track.id) || this.removed.has(track.id)) continue
      if (live >= MAX_QUEUE) continue
      // Copia con solo los campos conocidos: lo que sobre no se guarda ni se reenvía.
      this.tracks.set(track.id, {
        id: track.id,
        videoId: track.videoId,
        title: track.title,
        author: track.author,
        addedBy: track.addedBy,
        order: {counter: track.order.counter, peerId: track.order.peerId}
      })
      live += 1
    }
  }

  /** Lápidas de pistas desconocidas solo hasta un tope: así el propio `state` sigue siendo válido. */
  private tombstone(trackId: string): void {
    if (this.tracks.has(trackId) || this.removed.size < MAX_REMOVED) this.removed.add(trackId)
  }

  /** Si la pista actual está borrada, pasa a la siguiente (o se detiene). */
  private healPlayback(): Outgoing[] {
    const id = this.playback.trackId
    if (id === null || !this.removed.has(id)) return []
    const following = this.nextAfter(id)
    return this.writePlayback(following?.id ?? null, following !== undefined, 0)
  }

  private nextAfter(trackId: string): Track | undefined {
    const anchor = this.tracks.get(trackId)
    if (anchor === undefined) return undefined
    return this.queue().find(track => compareStamps(track.order, anchor.order) > 0)
  }

  private transit(from: PeerId, via: Via): number {
    if (via === 'relay') return RELAY_TRANSIT_MS
    return this.latency.get(from) ?? DEFAULT_DIRECT_TRANSIT_MS
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
