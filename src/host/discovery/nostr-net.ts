import type {Event, EventTemplate} from 'nostr-tools/core'
import type {Filter} from 'nostr-tools/filter'
import {SimplePool, useWebSocketImplementation} from 'nostr-tools/pool'
import {finalizeEvent, getPublicKey} from 'nostr-tools/pure'
import {WebSocket} from 'ws'

/** Lo que el descubrimiento necesita de Nostr. Se inyecta para poder probar sin red. */
export interface NostrNet {
  readonly pubkey: string
  /** Firma y publica; devuelve cuántos relays lo aceptaron. */
  publish(template: EventTemplate): Promise<number>
  subscribe(filter: Filter, handlers: {onevent: (event: Event) => void; oneose: () => void}): () => void
  /** Relays con conexión abierta ahora mismo. */
  connected(): number
  close(): void
}

export function createNostrNet(relays: string[], secret: Uint8Array): NostrNet {
  // El extension host trae WebSocket global desde Node 22; si no, el de `ws`.
  if (typeof globalThis.WebSocket === 'undefined') useWebSocketImplementation(WebSocket)
  // El pool comprueba la firma de cada evento que llega.
  const pool = new SimplePool({enableReconnect: true})
  return {
    pubkey: getPublicKey(secret),
    async publish(template) {
      const results = await Promise.allSettled(pool.publish(relays, finalizeEvent(template, secret)))
      return results.filter(result => result.status === 'fulfilled').length
    },
    subscribe(filter, handlers) {
      const subscription = pool.subscribeMany(relays, filter, {onevent: handlers.onevent, oneose: handlers.oneose})
      return () => subscription.close()
    },
    connected() {
      return [...pool.listConnectionStatus().values()].filter(Boolean).length
    },
    close() {
      pool.destroy()
    }
  }
}
