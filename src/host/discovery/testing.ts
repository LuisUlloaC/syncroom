import type {Event, EventTemplate} from 'nostr-tools/core'
import type {Filter} from 'nostr-tools/filter'
import type {Clock, Timers} from './clock'
import type {NostrNet} from './nostr-net'

/** Solo para pruebas. Un evento «firmado» de mentira: la firma la comprueba el pool, no el descubrimiento. */
export function asEvent(template: EventTemplate, pubkey = 'a'.repeat(64)): Event {
  return {...template, pubkey, id: '0'.repeat(64), sig: '0'.repeat(128)}
}

/** Reloj de prueba: el tiempo solo avanza con `advance`, que ejecuta en orden lo que venza. */
export class FakeClock implements Clock {
  private t = 1_760_000_000_000
  private seq = 0
  private readonly pending = new Map<number, {at: number; fn: () => void}>()

  readonly timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = ++this.seq
      this.pending.set(id, {at: this.t + ms, fn})
      return id
    },
    clearTimeout: handle => {
      if (typeof handle === 'number') this.pending.delete(handle)
    }
  }

  now(): number {
    return this.t
  }

  /** Mueve el reloj sin ejecutar lo que venza, como un equipo que se suspende: vencerá en el próximo `advance`. */
  jump(ms: number): void {
    this.t += ms
  }

  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (due === undefined) break
      this.pending.delete(due[0])
      this.t = due[1].at
      due[1].fn()
    }
    this.t = end
  }
}

interface FakeSub {
  filter: Filter
  onevent: (event: Event) => void
  oneose: () => void
  open: boolean
}

/** Red de prueba: guarda lo publicado y deja entregar eventos a mano. */
export class FakeNet implements NostrNet {
  readonly pubkey = 'b'.repeat(64)
  readonly published: EventTemplate[] = []
  readonly subs: FakeSub[] = []
  relaysOk = 4
  connectedRelays = 4
  closed = false
  /** Con `hold`, ningún publish responde hasta `release()`: relays lentos. */
  hold = false
  private held: (() => void)[] = []

  publish(template: EventTemplate): Promise<number> {
    this.published.push(template)
    if (!this.hold) return Promise.resolve(this.relaysOk)
    return new Promise(done => this.held.push(() => done(this.relaysOk)))
  }

  /** Responde a todo lo retenido. */
  release(): void {
    const held = this.held
    this.held = []
    for (const done of held) done()
  }

  subscribe(filter: Filter, handlers: {onevent: (event: Event) => void; oneose: () => void}): () => void {
    const sub: FakeSub = {filter, ...handlers, open: true}
    this.subs.push(sub)
    return () => {
      sub.open = false
    }
  }

  connected(): number {
    return this.connectedRelays
  }

  close(): void {
    this.closed = true
  }

  openSubs(): FakeSub[] {
    return this.subs.filter(sub => sub.open)
  }

  /** Entrega un evento a las suscripciones abiertas, como haría un relay. */
  emit(event: Event): void {
    for (const sub of this.openSubs()) sub.onevent(event)
  }
}
