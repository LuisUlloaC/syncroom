import type {Via} from '../../core/types'

/** Un camino de red: transporta sobres (texto JSON) sin interpretarlos. */
export interface Path {
  onReceive: ((envelope: string) => void) | undefined
  send(envelope: string): void
  close(): void
}

const MAX_REMEMBERED = 2000

/**
 * Une el camino directo y el de relays. Cada mensaje sale con un id; lo que llegue
 * repetido (por el otro camino, o como eco propio desde un relay) se descarta.
 */
export class Transport {
  private readonly seen = new Set<string>()
  private readonly order: string[] = []

  constructor(
    private readonly direct: Path | undefined,
    private readonly relay: Path,
    private readonly onMessage: (msg: unknown, via: Via) => void
  ) {
    if (direct !== undefined) direct.onReceive = envelope => this.receive(envelope, 'direct')
    relay.onReceive = envelope => this.receive(envelope, 'relay')
  }

  send(msg: unknown, useRelay: boolean): void {
    const id = crypto.randomUUID()
    this.remember(id)
    const envelope = JSON.stringify({id, msg})
    this.direct?.send(envelope)
    if (useRelay) this.relay.send(envelope)
  }

  close(): void {
    this.direct?.close()
    this.relay.close()
  }

  private receive(envelope: string, via: Via): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(envelope)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    const {id, msg} = parsed as {id?: unknown; msg?: unknown}
    if (typeof id !== 'string' || id === '' || this.seen.has(id)) return
    this.remember(id)
    this.onMessage(msg, via)
  }

  private remember(id: string): void {
    this.seen.add(id)
    this.order.push(id)
    if (this.order.length > MAX_REMEMBERED) {
      const oldest = this.order.shift()
      if (oldest !== undefined) this.seen.delete(oldest)
    }
  }
}
