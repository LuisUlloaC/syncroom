import {ANNOUNCE_KIND, readAnnouncement, type Scope} from './announcement'
import type {Clock} from './clock'
import type {NostrNet} from './nostr-net'
import {RoomList, type Hidden, type RoomRow} from './room-list'

export const REFRESH_MS = 15_000
export const SEARCH_TIMEOUT_MS = 5000
/** Basta para los anuncios vivos; evita basura de relays que no respetan la caducidad. */
export const SINCE_S = 900
/** Los eventos avisan como mucho una vez cada 250 ms (más uno al final): una avalancha no ahoga al host. */
export const NOTIFY_MS = 250

export type DirectoryStatus = 'searching' | 'ok' | 'offline'

export interface DirectoryView {
  status: DirectoryStatus
  rooms: RoomRow[]
  hiddenCount: number
}

/** La lista del lobby: se suscribe solo mientras está a la vista. */
export class Directory {
  private readonly list = new RoomList()
  private scopes: Scope[] = []
  private active = false
  private status: DirectoryStatus = 'searching'
  private closeSub: (() => void) | undefined
  private searchTimer: unknown
  private refreshTimer: unknown
  private notifyTimer: unknown
  private lastNotifyAt = Number.NEGATIVE_INFINITY
  /** Sube con cada suscripción: lo que llegue de una anterior se descarta. */
  private generation = 0

  constructor(private readonly opts: {net: NostrNet; clock: Clock; onChange: () => void}) {}

  setScopes(scopes: Scope[]): void {
    this.scopes = scopes
    this.list.clear()
    if (this.active) this.subscribe()
    this.opts.onChange()
  }

  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (active) this.subscribe()
    else this.unsubscribe()
  }

  view(hidden: Hidden): DirectoryView {
    const {rows, hiddenCount} = this.list.rows(this.nowS(), hidden)
    return {status: this.status, rooms: rows, hiddenCount}
  }

  ownerOf(code: string): string | undefined {
    return this.list.ownerOf(code)
  }

  dispose(): void {
    this.active = false
    this.unsubscribe()
  }

  private subscribe(): void {
    this.unsubscribe()
    const generation = ++this.generation
    const scopes = this.scopes
    this.status = 'searching'
    this.closeSub = this.opts.net.subscribe(
      {kinds: [ANNOUNCE_KIND], '#t': scopes.map(scope => scope.tag), since: this.nowS() - SINCE_S},
      {
        onevent: event => {
          void readAnnouncement(event, scopes).then(incoming => {
            if (incoming === undefined || generation !== this.generation) return
            const changed = this.list.apply(incoming, this.nowS())
            const wasSearching = this.status !== 'ok'
            this.status = 'ok'
            if (wasSearching) this.opts.onChange()
            else if (changed) this.notifySoon()
          })
        },
        oneose: () => this.settle(generation)
      }
    )
    this.searchTimer = this.opts.clock.timers.setTimeout(() => this.settle(generation), SEARCH_TIMEOUT_MS)
    this.scheduleRefresh(generation)
    this.opts.onChange()
  }

  /** Fin de la búsqueda inicial: con algún relay conectado es «ok» aunque no haya salas. */
  private settle(generation: number): void {
    if (generation !== this.generation || this.status !== 'searching') return
    this.status = this.opts.net.connected() === 0 ? 'offline' : 'ok'
    this.opts.onChange()
  }

  /** Cada 15 s: las salas sin renovar caducan en la vista y el estado de la red se recalcula. */
  private scheduleRefresh(generation: number): void {
    this.refreshTimer = this.opts.clock.timers.setTimeout(() => {
      if (generation !== this.generation) return
      if (this.status !== 'searching') this.status = this.opts.net.connected() === 0 ? 'offline' : 'ok'
      this.list.prune(this.nowS())
      this.opts.onChange()
      this.scheduleRefresh(generation)
    }, REFRESH_MS)
  }

  /** Aviso por eventos: el primero sale ya; los que lleguen en los 250 ms siguientes, juntos al final. */
  private notifySoon(): void {
    if (this.notifyTimer !== undefined) return
    const wait = this.lastNotifyAt + NOTIFY_MS - this.opts.clock.now()
    if (wait <= 0) {
      this.lastNotifyAt = this.opts.clock.now()
      this.opts.onChange()
      return
    }
    this.notifyTimer = this.opts.clock.timers.setTimeout(() => {
      this.notifyTimer = undefined
      this.lastNotifyAt = this.opts.clock.now()
      this.opts.onChange()
    }, wait)
  }

  private unsubscribe(): void {
    this.generation++
    this.closeSub?.()
    this.closeSub = undefined
    this.opts.clock.timers.clearTimeout(this.searchTimer)
    this.opts.clock.timers.clearTimeout(this.refreshTimer)
    this.opts.clock.timers.clearTimeout(this.notifyTimer)
    this.notifyTimer = undefined
  }

  private nowS(): number {
    return Math.floor(this.opts.clock.now() / 1000)
  }
}
