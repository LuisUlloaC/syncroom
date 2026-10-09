import type {Event, EventTemplate} from 'nostr-tools/core'

/** Solo para pruebas. Un evento «firmado» de mentira: la firma la comprueba el pool, no el descubrimiento. */
export function asEvent(template: EventTemplate, pubkey = 'a'.repeat(64)): Event {
  return {...template, pubkey, id: '0'.repeat(64), sig: '0'.repeat(128)}
}
