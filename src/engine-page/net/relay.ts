import {SimplePool} from 'nostr-tools/pool'
import {finalizeEvent, generateSecretKey} from 'nostr-tools/pure'
import {decryptText, encryptText, type RoomKeys} from './crypto'
import type {Path} from './transport'

/** Rango 20000–29999 = eventos efímeros: los relays los reparten y no los guardan. */
export const RELAY_EVENT_KIND = 20777

export interface RelayPathOptions {
  relays: string[]
  keys: RoomKeys
  /** Cuántos relays aceptaron el último envío. */
  onStatus: (ok: number) => void
}

export function createRelayPath(options: RelayPathOptions): Path {
  const pool = new SimplePool({enableReconnect: true})
  // Identidad de Nostr de usar y tirar: solo sirve para firmar los eventos de esta sesión.
  const secret = generateSecretKey()

  const path: Path = {
    onReceive: undefined,
    send(envelope) {
      void (async () => {
        const content = await encryptText(options.keys.aesKey, envelope)
        const event = finalizeEvent(
          {
            kind: RELAY_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['t', options.keys.tag]],
            content
          },
          secret
        )
        const results = await Promise.allSettled(pool.publish(options.relays, event))
        options.onStatus(results.filter(result => result.status === 'fulfilled').length)
      })().catch(() => options.onStatus(0))
    },
    close() {
      subscription.close()
      pool.destroy()
    }
  }

  // Sin `since`: los eventos efímeros no se guardan y así no dependemos del reloj del equipo.
  const subscription = pool.subscribeMany(
    options.relays,
    {kinds: [RELAY_EVENT_KIND], '#t': [options.keys.tag]},
    {
      onevent(event) {
        decryptText(options.keys.aesKey, event.content).then(
          envelope => path.onReceive?.(envelope),
          () => undefined // no es de esta sala o está alterado
        )
      }
    }
  )

  return path
}
