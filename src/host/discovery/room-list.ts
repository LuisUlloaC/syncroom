import type {Announcement, Incoming} from './announcement'

export const FRESH_PAST_S = 300
export const FRESH_FUTURE_S = 300
export const MAX_ROWS = 50
/** Tope de lo que se guarda (no solo de lo que se pinta): cualquiera puede publicar con claves nuevas. */
export const MAX_ENTRIES = 1000
export const MAX_PER_PUBKEY = 10

export interface Hidden {
  rooms: string[]
  /** Claves públicas de creadores ocultos. */
  owners: string[]
}

export interface RoomRow {
  code: string
  owner: string
  playing: string | null
  listeners: number
  locked: boolean
  group: string | null
}

interface Entry {
  pubkey: string
  createdAt: number
  group: string | null
  /** null = lápida: se guarda para que una copia vieja del anuncio no resucite la sala. */
  announcement: Announcement | null
}

type LiveEntry = Entry & {announcement: Announcement}

/** Anuncios recibidos → filas del lobby: frescura, una fila por código, ocultas, orden y tope. */
export class RoomList {
  private readonly entries = new Map<string, Entry>()
  /** Clave pública → claves de sus entradas: para el tope por creador. */
  private readonly byPubkey = new Map<string, Set<string>>()
  /** Código → clave pública que ya enseñamos para él: un recién llegado no se queda con el código. */
  private readonly shown = new Map<string, string>()

  get size(): number {
    return this.entries.size
  }

  /**
   * true si cambió algo. Lo más antiguo que lo guardado se ignora: los relays repiten y desordenan.
   * Lo que cae fuera de la ventana de frescura no se guarda: no se enseñaría y solo ocuparía memoria.
   * Una lápida de una sala que no conocíamos sí se guarda mientras es fresca: así una copia vieja del
   * anuncio que llegue después por otro relay no resucita la sala.
   */
  apply(incoming: Incoming, nowS: number): boolean {
    if (incoming.createdAt < nowS - FRESH_PAST_S || incoming.createdAt > nowS + FRESH_FUTURE_S) return false
    const current = this.entries.get(incoming.key)
    if (current !== undefined && incoming.createdAt < current.createdAt) return false
    if (
      current !== undefined &&
      current.createdAt === incoming.createdAt &&
      JSON.stringify(current.announcement) === JSON.stringify(incoming.announcement)
    ) {
      return false
    }
    this.entries.set(incoming.key, {
      pubkey: incoming.pubkey,
      createdAt: incoming.createdAt,
      group: incoming.group,
      announcement: incoming.announcement
    })
    if (current === undefined) {
      const keys = this.byPubkey.get(incoming.pubkey) ?? new Set<string>()
      keys.add(incoming.key)
      this.byPubkey.set(incoming.pubkey, keys)
      if (keys.size > MAX_PER_PUBKEY) this.evictOldest(keys)
      if (this.entries.size > MAX_ENTRIES) this.evictOldest(this.entries.keys())
    }
    return this.entries.has(incoming.key)
  }

  /** Olvida lo que ya no es fresco (anuncios y lápidas). La lista lo llama en cada repaso. */
  prune(nowS: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.createdAt < nowS - FRESH_PAST_S) this.remove(key)
    }
    const codes = new Set<string>()
    for (const entry of this.entries.values()) if (isLive(entry)) codes.add(entry.announcement.code)
    for (const code of this.shown.keys()) if (!codes.has(code)) this.shown.delete(code)
  }

  rows(nowS: number, hidden: Hidden): {rows: RoomRow[]; hiddenCount: number} {
    const byCode = new Map<string, LiveEntry[]>()
    for (const entry of this.entries.values()) {
      if (!isLive(entry) || entry.createdAt < nowS - FRESH_PAST_S || entry.createdAt > nowS + FRESH_FUTURE_S) continue
      const code = entry.announcement.code
      const candidates = byCode.get(code)
      if (candidates === undefined) byCode.set(code, [entry])
      else candidates.push(entry)
    }
    const hiddenOwners = new Set(hidden.owners)
    const hiddenRooms = new Set(hidden.rooms)
    const chosen: LiveEntry[] = []
    let hiddenCount = 0
    for (const [code, all] of byCode) {
      // Los creadores ocultos se quitan antes de elegir: ocultar a un impostor no se lleva la sala de verdad.
      const candidates = all.filter(entry => !hiddenOwners.has(entry.pubkey))
      if (candidates.length === 0 || hiddenRooms.has(code)) {
        hiddenCount++
        continue
      }
      const known = candidates.find(entry => entry.pubkey === this.shown.get(code))
      const pick = known ?? candidates.reduce((best, entry) => (entry.createdAt > best.createdAt ? entry : best))
      this.shown.set(code, pick.pubkey)
      chosen.push(pick)
    }
    chosen.sort((a, b) => b.announcement.listeners - a.announcement.listeners || b.createdAt - a.createdAt)
    return {rows: chosen.slice(0, MAX_ROWS).map(toRow), hiddenCount}
  }

  /** Clave pública del creador que enseñamos para ese código (para «Ocultar creador»). */
  ownerOf(code: string): string | undefined {
    return this.shown.get(code)
  }

  clear(): void {
    this.entries.clear()
    this.byPubkey.clear()
    this.shown.clear()
  }

  private evictOldest(keys: Iterable<string>): void {
    let oldest: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const key of keys) {
      const at = this.entries.get(key)?.createdAt ?? Number.POSITIVE_INFINITY
      if (at < oldestAt) {
        oldest = key
        oldestAt = at
      }
    }
    if (oldest !== undefined) this.remove(oldest)
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.delete(key)
    const keys = this.byPubkey.get(entry.pubkey)
    keys?.delete(key)
    if (keys?.size === 0) this.byPubkey.delete(entry.pubkey)
  }
}

function isLive(entry: Entry): entry is LiveEntry {
  return entry.announcement !== null
}

function toRow(entry: LiveEntry): RoomRow {
  const a = entry.announcement
  return {code: a.code, owner: a.owner, playing: a.playing, listeners: a.listeners, locked: a.locks.queue || a.locks.playback, group: entry.group}
}
