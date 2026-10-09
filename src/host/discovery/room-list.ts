import type {Announcement, Incoming} from './announcement'

export const FRESH_PAST_S = 300
export const FRESH_FUTURE_S = 300
export const MAX_ROWS = 50

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
  /** Código → clave pública que ya enseñamos para él: un recién llegado no se queda con el código. */
  private readonly shown = new Map<string, string>()

  /** true si cambió algo. Lo más antiguo que lo guardado se ignora: los relays repiten y desordenan. */
  apply(incoming: Incoming): boolean {
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
    return true
  }

  rows(nowS: number, hidden: Hidden): {rows: RoomRow[]; hiddenCount: number} {
    const byCode = new Map<string, LiveEntry[]>()
    for (const entry of this.entries.values()) {
      if (!isLive(entry) || entry.createdAt < nowS - FRESH_PAST_S || entry.createdAt > nowS + FRESH_FUTURE_S) continue
      const code = entry.announcement.code
      byCode.set(code, [...(byCode.get(code) ?? []), entry])
    }
    const chosen: LiveEntry[] = []
    for (const [code, candidates] of byCode) {
      const known = candidates.find(entry => entry.pubkey === this.shown.get(code))
      const pick = known ?? candidates.reduce((best, entry) => (entry.createdAt > best.createdAt ? entry : best))
      this.shown.set(code, pick.pubkey)
      chosen.push(pick)
    }
    const visible = chosen.filter(entry => !hidden.rooms.includes(entry.announcement.code) && !hidden.owners.includes(entry.pubkey))
    visible.sort((a, b) => b.announcement.listeners - a.announcement.listeners || b.createdAt - a.createdAt)
    return {rows: visible.slice(0, MAX_ROWS).map(toRow), hiddenCount: chosen.length - visible.length}
  }

  /** Clave pública del creador que enseñamos para ese código (para «Ocultar creador»). */
  ownerOf(code: string): string | undefined {
    return this.shown.get(code)
  }

  clear(): void {
    this.entries.clear()
    this.shown.clear()
  }
}

function isLive(entry: Entry): entry is LiveEntry {
  return entry.announcement !== null
}

function toRow(entry: LiveEntry): RoomRow {
  const a = entry.announcement
  return {code: a.code, owner: a.owner, playing: a.playing, listeners: a.listeners, locked: a.locks.queue || a.locks.playback, group: entry.group}
}
