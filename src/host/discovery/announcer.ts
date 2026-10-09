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
  /** La sala cuyo anuncio llegó a salir y no se ha retirado: solo eso necesita lápida. */
  private announced: Current | undefined
  /**
   * Lo que se prepara para la red va en fila (solo la preparación, que es local y rápida): un anuncio
   * retirado mientras esperaba su turno ya no sale. Las respuestas de los relays no retienen la fila:
   * el orden en el relay lo garantiza el created_at creciente.
   */
  private chain: Promise<void> = Promise.resolve()
  /** Lápidas y borrados enviados que aún esperan respuesta: stop() los espera (con tope). */
  private readonly retiring = new Set<Promise<unknown>>()

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
    const sent = this.chain.then(() => Promise.allSettled([...this.retiring]))
    await Promise.race([sent, timeout])
    this.opts.clock.timers.clearTimeout(timer)
  }

  private publish(): void {
    const current = this.current
    if (current === undefined) return
    this.lastPublishAt = this.opts.clock.now()
    this.publishedKey = keyOf(current)
    // Una renovación (o cualquier publicación) lleva ya lo último: una publicación temprana pendiente sobra.
    this.opts.clock.timers.clearTimeout(this.pendingTimer)
    this.pendingTimer = undefined
    this.opts.clock.timers.clearTimeout(this.renewTimer)
    this.renewTimer = this.opts.clock.timers.setTimeout(() => this.publish(), RENEW_MS)
    const createdAt = this.nextCreatedAt()
    this.enqueue(async () => {
      // Se retiró (o cambió de sala) mientras esperaba su turno o se cifraba: no resucitarla.
      if (!sameRoom(this.current, current)) return
      const template = await buildAnnouncement(current.scope, current.snapshot, createdAt)
      if (!sameRoom(this.current, current)) return
      this.announced = current
      void this.opts.net.publish(template).then(relaysOk => {
        // La cuenta de un anuncio que estaba en vuelo durante un cambio de ámbito no es del nuevo.
        if (sameRoom(this.current, current)) this.opts.onStatus(relaysOk)
      }, () => undefined)
    })
  }

  private retire(previous: Current): void {
    if (!sameRoom(this.announced, previous)) return
    this.announced = undefined
    const createdAt = this.nextCreatedAt()
    const {scope, snapshot} = previous
    this.enqueue(async () => {
      const tombstone = await buildTombstone(scope, snapshot.code, createdAt)
      const deletion = await buildDeletion(scope, snapshot.code, this.opts.net.pubkey, createdAt)
      // A la vez: el borrado no espera a que el relay más lento confirme la lápida.
      const sent = Promise.allSettled([this.opts.net.publish(tombstone), this.opts.net.publish(deletion)])
      this.retiring.add(sent)
      void sent.then(() => this.retiring.delete(sent))
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
