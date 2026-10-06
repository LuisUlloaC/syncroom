import type {PeerId, Stamp} from './types'

export const ZERO_STAMP: Stamp = {counter: 0, peerId: ''}

/** Tope de contador aceptado de la red. Un contador «infinito» inutilizaría las escrituras de todos. */
export const MAX_COUNTER = 2 ** 40
/** Margen que se deja por debajo del tope para que el reloj local pueda seguir avanzando. */
const HEADROOM = 2 ** 20

export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.counter !== b.counter) return a.counter - b.counter
  if (a.peerId === b.peerId) return 0
  return a.peerId < b.peerId ? -1 : 1
}

export class LamportClock {
  private counter = 0

  constructor(private readonly peerId: PeerId) {}

  tick(): Stamp {
    this.counter += 1
    return {counter: this.counter, peerId: this.peerId}
  }

  observe(stamp: Stamp): void {
    if (stamp.counter > this.counter && stamp.counter <= MAX_COUNTER - HEADROOM) this.counter = stamp.counter
  }
}
