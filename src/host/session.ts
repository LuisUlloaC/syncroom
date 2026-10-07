import {RoomState} from '../core/room-state'
import {reconcile, type Desired, type PlayerStatus} from '../core/sync'
import type {Outgoing, Peer} from '../core/types'
import {MAX_CHAT, isRoomMessage} from '../core/validate'
import type {EngineLink, EngineToHost} from '../protocol/bridge'
import type {ResolvedLink} from '../resolve/youtube'

export interface SessionOptions {
  code: string
  peerId: string
  name: string
  /** false = solo relays (no se revela la IP a los demás). */
  direct: boolean
  relays: string[]
  volume: number
  link: EngineLink
  resolve: (input: string) => Promise<ResolvedLink>
  now?: () => number
  /** Cuánto se espera al «ready» del motor tras lanzarlo. */
  readyTimeoutMs?: number
  /** Registro de diagnóstico (canal de salida de VS Code). */
  log?: (text: string) => void
}

export interface TrackView {
  id: string
  videoId: string
  title: string
  author: string
  addedBy: string
  current: boolean
  unplayable: boolean
}

export interface ChatLine {
  /** Clave local, única en esta sesión (el id del emisor no es de fiar). */
  key: number
  id: string
  /** `present`: quienes ya estaban al entrar (nombres en `text`). */
  kind: 'message' | 'joined' | 'left' | 'present'
  from: string
  name: string
  /** Vacío en joined/left. */
  text: string
  /** Hora local de llegada: no hay reloj común. */
  at: number
  mine: boolean
}

export interface RoomView {
  code: string
  me: Peer
  peers: Peer[]
  tracks: TrackView[]
  chat: ChatLine[]
  playback: {trackId: string | null; playing: boolean; positionS: number; durationS: number}
  engineReady: boolean
  /** Código del fallo que impide reproducir aunque el motor esté en marcha. */
  fault: string | undefined
  net: {directPeers: number; relaysOk: number}
  volume: number
}

const TICK_MS = 1000
const HEARTBEAT_EVERY = 5
const RELAY_HEARTBEAT_EVERY = 15
const PING_EVERY = 10
const DRIFT_EVERY = 5
const PEER_TIMEOUT_MS = 35_000
const TIGHT_TOLERANCE_S = 0.75
const DRIFT_TOLERANCE_S = 2
const LOAD_GRACE_MS = 1500
const DEFAULT_READY_TIMEOUT_MS = 20_000
const MAX_CHAT_LINES = 200
/** Quien aparece en este margen tras arrancar «ya estaba»: una sola línea, no una por persona. */
const PRESENCE_GRACE_MS = 8000
/** Códigos del IFrame API: parámetro inválido, error HTML5, no existe, incrustación prohibida (x2). */
const UNPLAYABLE_CODES = new Set([2, 5, 100, 101, 150])

const NOTHING_LOADED: PlayerStatus = {videoId: null, state: 'unstarted', timeS: 0, durationS: 0}

export const MAX_NAME = 40

export class RoomSession {
  private readonly state: RoomState
  private name: string
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private readonly failureListeners = new Set<() => void>()
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeDrop: (() => void) | undefined
  private readonly unplayable = new Set<string>()
  /** Estado del reproductor, ya con las órdenes enviadas anotadas encima. */
  private status: PlayerStatus | undefined
  /** Último estado tal como lo informó el reproductor, sin anotar. */
  private reported: PlayerStatus | undefined
  private engineReady = false
  private fault: string | undefined
  private net = {directPeers: 0, relaysOk: 0}
  private volume: number
  private ticks = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  private lastPlaybackKey = ''
  private loadGraceUntil = 0
  private chat: ChatLine[] = []
  private chatSeq = 0
  /** Participantes ya anunciados en el chat (id → nombre), para detectar llegadas y salidas. */
  private announced = new Map<string, string>()
  /** Hasta cuándo los recién vistos cuentan como «ya estaban». */
  private presenceGraceUntil = 0
  private presenceSummaryDue = false

  constructor(private readonly opts: SessionOptions) {
    this.now = opts.now ?? (() => Date.now())
    this.volume = clampVolume(opts.volume)
    this.name = opts.name
    this.state = new RoomState({peerId: opts.peerId, name: opts.name, now: this.now})
    this.state.onChange(() => this.onStateChange())
  }

  start(): void {
    this.unsubscribe = this.opts.link.onMessage(msg => this.onEngine(msg))
    this.unsubscribeDrop = this.opts.link.onDisconnect?.(() => {
      if (this.engineReady) this.engineFailed()
    })
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /** Llamar justo después de lanzar el motor: si no dice «ready» a tiempo, se da por caído. */
  expectEngine(): void {
    this.log('waiting for the engine to say ready')
    this.fault = undefined
    this.clearReadyTimer()
    this.readyTimer = setTimeout(() => this.engineFailed(), this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
  }

  onEngineFailure(listener: () => void): () => void {
    this.failureListeners.add(listener)
    return () => {
      this.failureListeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.clearReadyTimer()
    this.unsubscribeDrop?.()
    this.unsubscribeDrop = undefined
    if (this.engineReady) {
      this.sendAll(this.state.leave())
      this.opts.link.send({t: 'leave'})
    }
    this.engineReady = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  // ── Lo que ve la interfaz ────────────────────────────────────────────────

  view(): RoomView {
    const playback = this.state.getPlayback()
    const current = this.state.currentTrack()
    const durationS = current !== undefined && this.status?.videoId === current.videoId ? this.status.durationS : 0
    const expected = current === undefined ? 0 : this.state.expectedPosition()
    return {
      code: this.opts.code,
      me: {id: this.opts.peerId, name: this.name},
      peers: this.state.peerList(),
      chat: this.chat,
      tracks: this.state.queue().map(track => ({
        id: track.id,
        videoId: track.videoId,
        title: track.title,
        author: track.author,
        addedBy: track.addedBy,
        current: track.id === current?.id,
        unplayable: this.unplayable.has(track.id)
      })),
      playback: {
        trackId: current?.id ?? null,
        playing: current !== undefined && playback.playing,
        positionS: durationS > 0 ? Math.min(expected, durationS) : expected,
        durationS
      },
      engineReady: this.engineReady,
      fault: this.fault,
      net: this.net,
      volume: this.volume
    }
  }

  playerStatus(): PlayerStatus | undefined {
    return this.status
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ── Acciones del usuario ─────────────────────────────────────────────────

  async addLink(input: string): Promise<{added: number; truncated: boolean}> {
    const resolved = await this.opts.resolve(input)
    const before = this.state.queue().length
    this.sendAll(this.state.addTracks(resolved.metas, resolved.startIndex))
    return {added: this.state.queue().length - before, truncated: resolved.truncated}
  }

  togglePlay(): void {
    this.sendAll(this.state.setPlaying(!this.view().playback.playing))
  }

  next(): void {
    this.sendAll(this.state.next())
  }

  playNow(trackId: string): void {
    this.sendAll(this.state.playTrack(trackId))
  }

  remove(trackId: string): void {
    this.sendAll(this.state.removeTrack(trackId))
  }

  move(trackId: string, beforeId: string | null, afterId: string | null): void {
    this.sendAll(this.state.moveTrack(trackId, beforeId, afterId))
  }

  playNext(trackId: string): void {
    this.sendAll(this.state.playNext(trackId))
  }

  seek(positionS: number): void {
    this.sendAll(this.state.seek(positionS))
  }

  /** Nombre nuevo, recortado y acotado; vacío se ignora. Se anuncia al momento si el motor está listo. */
  rename(name: string): void {
    const clean = name.trim().slice(0, MAX_NAME)
    if (clean === '' || clean === this.name) return
    this.name = clean
    this.sendAll(this.state.setName(clean))
    this.emit()
  }

  /** Manda un mensaje de chat (recortado y acotado a 500 caracteres); vacío se ignora. */
  say(text: string): void {
    const clean = text.trim().slice(0, MAX_CHAT)
    // Sin motor no hay red: no se finge que salió.
    if (clean === '' || !this.engineReady) return
    const out = this.state.chatMessage(clean)
    const id = out.msg.type === 'chat' ? out.msg.id : `${this.opts.peerId}:${this.chatSeq}`
    this.pushChat({key: 0, id, kind: 'message', from: this.opts.peerId, name: this.name, text: clean, at: this.now(), mine: true})
    this.sendAll([out])
    this.emit()
  }

  setVolume(value: number): void {
    this.volume = clampVolume(value)
    if (this.engineReady) this.opts.link.send({t: 'volume', value: this.volume})
    this.emit()
  }

  // ── Motor ────────────────────────────────────────────────────────────────

  private onEngine(msg: EngineToHost): void {
    switch (msg.t) {
      case 'ready':
        // También llega tras reiniciar el motor: la página nueva no tiene nada cargado.
        this.clearReadyTimer()
        this.log('engine ready')
        this.engineReady = true
        this.status = NOTHING_LOADED
        this.reported = undefined
        this.loadGraceUntil = 0
        if (this.announced.size === 0 && this.chat.length === 0) {
          this.presenceGraceUntil = this.now() + PRESENCE_GRACE_MS
          this.presenceSummaryDue = true
        }
        this.opts.link.send({t: 'join', code: this.opts.code, direct: this.opts.direct, relays: this.opts.relays})
        this.opts.link.send({t: 'volume', value: this.volume})
        this.sendAll(this.state.join())
        this.reconcileNow(TIGHT_TOLERANCE_S)
        this.emit()
        break
      case 'msg':
        if (!isRoomMessage(msg.msg)) break
        // Primero el estado (así «entró» precede al primer mensaje de alguien nuevo), luego la línea.
        this.sendAll(this.state.receive(msg.msg, msg.via))
        if (msg.msg.type === 'chat' && msg.msg.from !== this.opts.peerId) {
          const {from, id, text} = msg.msg
          if (this.chat.some(line => line.kind === 'message' && line.from === from && line.id === id)) break
          const name = msg.msg.name !== '' ? msg.msg.name : this.state.peerName(from)
          this.pushChat({key: 0, id, kind: 'message', from, name, text, at: this.now(), mine: false})
          this.emit()
        }
        break
      case 'status': {
        if (this.now() < this.loadGraceUntil && msg.status.videoId !== this.status?.videoId) break
        // Se compara con lo último que informó el reproductor, no con lo anotado al mandar la orden:
        // el estado que llega justo tras una orden aún no la refleja, y tomarlo por un cambio
        // encadenaba órdenes sin fin mientras YouTube arrancaba.
        const before = this.reported
        this.reported = msg.status
        this.status = msg.status
        // Un cambio de estado real (p. ej. acaba de cargar) se corrige al momento, no en el próximo tick.
        if (before === undefined || before.state !== msg.status.state || before.videoId !== msg.status.videoId) {
          this.reconcileNow(TIGHT_TOLERANCE_S)
        }
        this.emit()
        break
      }
      case 'ended': {
        const current = this.state.currentTrack()
        if (current !== undefined && current.videoId === msg.videoId) this.sendAll(this.state.trackEnded(current.id))
        break
      }
      case 'error': {
        this.log(`player error ${msg.code} on ${msg.videoId ?? 'nothing'}`)
        const current = this.state.currentTrack()
        if (current !== undefined && current.videoId === msg.videoId && UNPLAYABLE_CODES.has(msg.code)) {
          this.unplayable.add(current.id)
          this.reconcileNow(TIGHT_TOLERANCE_S)
          this.emit()
        }
        break
      }
      case 'net':
        this.net = {directPeers: msg.directPeers, relaysOk: msg.relaysOk}
        this.emit()
        break
      case 'log':
        this.log(`engine: ${msg.text}`)
        break
      case 'fault':
        this.fault = msg.code
        this.log(`engine fault: ${msg.code}`)
        this.emit()
        break
    }
  }

  private tick(): void {
    this.ticks += 1
    if (!this.engineReady) return
    if (this.presenceSummaryDue && this.now() >= this.presenceGraceUntil) this.presenceSummary()
    if (this.ticks % HEARTBEAT_EVERY === 0) {
      this.sendAll(this.state.heartbeat(this.ticks % RELAY_HEARTBEAT_EVERY === 0))
    }
    if (this.ticks % PING_EVERY === 0) this.sendAll(this.state.pings())
    if (this.ticks % DRIFT_EVERY === 0) {
      this.state.expirePeers(PEER_TIMEOUT_MS)
      this.reconcileNow(DRIFT_TOLERANCE_S)
    }
  }

  /** Compara los participantes con nombre contra los ya anunciados y escribe «entró» / «salió». */
  private announcePresence(): void {
    const present = new Map(this.state.peerList().filter(p => p.id !== this.opts.peerId && p.name !== '').map(p => [p.id, p.name]))
    const settling = this.now() < this.presenceGraceUntil
    for (const [id, name] of present) {
      if (this.announced.has(id)) continue
      // Durante el margen de entrada se anota sin línea: saldrán juntos en el resumen.
      if (!settling) this.pushChat({key: 0, id: `joined:${id}`, kind: 'joined', from: id, name, text: '', at: this.now(), mine: false})
    }
    for (const [id, name] of this.announced) {
      if (!present.has(id)) this.pushChat({key: 0, id: `left:${id}`, kind: 'left', from: id, name, text: '', at: this.now(), mine: false})
    }
    this.announced = present
  }

  /** Al cerrarse el margen de entrada: una sola línea con quienes ya estaban. */
  private presenceSummary(): void {
    this.presenceSummaryDue = false
    const names = [...this.announced.values()].sort((a, b) => a.localeCompare(b))
    if (names.length === 0) return
    this.pushChat({key: 0, id: 'present', kind: 'present', from: '', name: '', text: names.join(', '), at: this.now(), mine: false})
    this.emit()
  }

  private pushChat(line: ChatLine): void {
    this.chatSeq += 1
    this.chat = [...this.chat.slice(-(MAX_CHAT_LINES - 1)), {...line, key: this.chatSeq}]
  }

  private onStateChange(): void {
    this.announcePresence()
    const stamp = this.state.getPlayback().stamp
    const key = `${stamp.counter}:${stamp.peerId}:${this.state.currentTrack()?.id ?? ''}`
    if (key !== this.lastPlaybackKey) {
      this.lastPlaybackKey = key
      this.reconcileNow(TIGHT_TOLERANCE_S)
    }
    this.emit()
  }

  private desired(): Desired {
    const current = this.state.currentTrack()
    if (current === undefined || this.unplayable.has(current.id)) return {videoId: null, playing: false, positionS: 0}
    return {videoId: current.videoId, playing: this.state.getPlayback().playing, positionS: this.state.expectedPosition()}
  }

  private reconcileNow(toleranceS: number): void {
    if (!this.engineReady || this.status === undefined) return
    for (const cmd of reconcile(this.desired(), this.status, toleranceS)) {
      this.opts.link.send({t: 'player', cmd})
      // Se anota lo que el reproductor va a hacer, para no repetir la orden antes de su próximo estado.
      switch (cmd.type) {
        case 'load':
          this.status = {videoId: cmd.videoId, state: 'buffering', timeS: cmd.startS, durationS: 0}
          this.loadGraceUntil = this.now() + LOAD_GRACE_MS
          break
        case 'stop':
          this.status = NOTHING_LOADED
          break
        case 'seek':
          this.status = {...this.status, timeS: cmd.timeS}
          break
        case 'play':
          this.status = {...this.status, state: 'playing'}
          break
        case 'pause':
          this.status = {...this.status, state: 'paused'}
          break
      }
    }
  }

  private engineFailed(): void {
    this.log(this.engineReady ? 'engine link lost' : 'engine never said ready')
    this.clearReadyTimer()
    this.engineReady = false
    this.fault = undefined
    this.status = undefined
    this.reported = undefined
    this.emit()
    for (const listener of this.failureListeners) listener()
  }

  private log(text: string): void {
    this.opts.log?.(text)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.readyTimer = undefined
  }

  private sendAll(outgoing: Outgoing[]): void {
    if (!this.engineReady) return
    for (const out of outgoing) this.opts.link.send({t: 'send', msg: out.msg, relay: out.relay})
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function clampVolume(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}
