import {buildAnnouncement, buildDeletion, buildTombstone, type Announcement, type Scope} from './announcement'
import type {Clock} from './clock'
import type {NostrNet} from './nostr-net'

export const RENEW_MS = 60_000
export const MIN_GAP_MS = 10_000
export const STOP_TIMEOUT_MS = 1500

interface Current {
  scope: Scope
  snapshot: Announcement
}

const keyOf = (current: Current): string => `${current.scope.tag}|${JSON.stringify(current.snapshot)}`
const sameRoom = (a: Current | undefined, b: Current): boolean =>
  a !== undefined && a.scope.tag === b.scope.tag && a.snapshot.code === b.snapshot.code

/** Mantiene publicado el anuncio de la sala propia: lo renueva, lo actualiza y lo retira. */
export class Announcer {
  private current: Current | undefined
  /** Ámbito + anuncio de la última publicación: lo mismo no se repite antes de la renovación. */
  private publishedKey = ''
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private lastCreatedAt = 0
  private renewTimer: unknown
  private pendingTimer: unknown
  /** Todo lo que sale a la red va en fila: una lápida nunca adelanta a un anuncio en vuelo. */
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly opts: {net: NostrNet; clock: Clock; onStatus: (relaysOk: number) => void}) {}

  /** Llamar con cada cambio. undefined en cualquiera de los dos = no anunciar (retira lo que hubiera). */
  update(scope: Scope | undefined, snapshot: Announcement | undefined): void {
    const previous = this.current
    if (scope === undefined || snapshot === undefined) {
      this.current = undefined
      this.publishedKey = ''
      this.clearTimers()
      if (previous !== undefined) this.retire(previous)
      return
    }
    const next: Current = {scope, snapshot}
    if (previous !== undefined && !sameRoom(previous, next)) {
      this.retire(previous)
      this.publishedKey = ''
    }
    this.current = next
    if (keyOf(next) === this.publishedKey || this.pendingTimer !== undefined) return
    const wait = Math.max(0, this.lastPublishAt + MIN_GAP_MS - this.opts.clock.now())
    this.pendingTimer = this.opts.clock.timers.setTimeout(() => {
      this.pendingTimer = undefined
      this.publish()
    }, wait)
  }

  /** Retira el anuncio y espera a que salga, como mucho 1,5 s (VS Code cerrándose no espera más). */
  async stop(): Promise<void> {
    this.update(undefined, undefined)
    let timer: unknown
    const timeout = new Promise<void>(done => {
      timer = this.opts.clock.timers.setTimeout(done, STOP_TIMEOUT_MS)
    })
    await Promise.race([this.chain, timeout])
    this.opts.clock.timers.clearTimeout(timer)
  }

  private publish(): void {
    const current = this.current
    if (current === undefined) return
    this.lastPublishAt = this.opts.clock.now()
    this.publishedKey = keyOf(current)
    this.opts.clock.timers.clearTimeout(this.renewTimer)
    this.renewTimer = this.opts.clock.timers.setTimeout(() => this.publish(), RENEW_MS)
    const createdAt = this.nextCreatedAt()
    this.enqueue(async () => {
      // Se retiró (o cambió de sala) mientras esperaba su turno: no resucitarla.
      if (!sameRoom(this.current, current)) return
      const template = await buildAnnouncement(current.scope, current.snapshot, createdAt)
      this.opts.onStatus(await this.opts.net.publish(template))
    })
  }

  private retire(previous: Current): void {
    const createdAt = this.nextCreatedAt()
    const {scope, snapshot} = previous
    this.enqueue(async () => {
      await this.opts.net.publish(await buildTombstone(scope, snapshot.code, createdAt))
      await this.opts.net.publish(await buildDeletion(scope, snapshot.code, this.opts.net.pubkey, createdAt))
    })
  }

  private enqueue(op: () => Promise<void>): void {
    this.chain = this.chain.then(op).catch(() => undefined)
  }

  /** Segundos y siempre crecientes: con la misma marca un relay podría quedarse con la versión vieja. */
  private nextCreatedAt(): number {
    this.lastCreatedAt = Math.max(Math.floor(this.opts.clock.now() / 1000), this.lastCreatedAt + 1)
    return this.lastCreatedAt
  }

  private clearTimers(): void {
    this.opts.clock.timers.clearTimeout(this.pendingTimer)
    this.opts.clock.timers.clearTimeout(this.renewTimer)
    this.pendingTimer = undefined
    this.renewTimer = undefined
  }
}
