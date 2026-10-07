export type PeerId = string

/** Marca de Lamport: ordena escrituras sin depender de la hora del sistema. */
export interface Stamp {
  counter: number
  peerId: PeerId
}

export interface Track {
  id: string
  videoId: string
  title: string
  author: string
  addedBy: string
  /** Marca de alta: identifica la pista y desempata ranks iguales. */
  order: Stamp
  /** Posición en la cola: índice fraccionario (base62); se compara como texto. */
  rank: string
  /** Última vez que se fijó `rank`; gana la marca mayor. */
  moved: Stamp
}

/** Reproducción tal como se guarda en local: `anchorAt` está en el reloj de este equipo. */
export interface Playback {
  trackId: string | null
  playing: boolean
  positionS: number
  anchorAt: number
  stamp: Stamp
}

/** Reproducción tal como viaja: lleva la edad del ancla en vez de una hora absoluta. */
export interface PlaybackWire {
  trackId: string | null
  playing: boolean
  positionS: number
  ageMs: number
  stamp: Stamp
}

export interface Peer {
  id: PeerId
  name: string
}

/**
 * Quién manda en la sala y qué bloquea. `ownerKey` es estable por instalación (sobrevive a salir y
 * volver); `ownerPeerId` es el peer actual del dueño. Solo gana una política más nueva del mismo dueño.
 */
export interface Policy {
  ownerKey: string
  ownerPeerId: PeerId
  ownerName: string
  lockQueue: boolean
  lockPlayback: boolean
  stamp: Stamp
}

export interface Locks {
  lockQueue?: boolean
  lockPlayback?: boolean
}

export type Via = 'direct' | 'relay'

export type RoomMessage =
  | {type: 'hello'; from: PeerId; name: string; digest: string}
  | {type: 'state'; from: PeerId; name: string; tracks: Track[]; removed: string[]; playback: PlaybackWire; policy?: Policy}
  | {type: 'policy'; from: PeerId; policy: Policy}
  | {type: 'add'; from: PeerId; tracks: Track[]}
  | {type: 'remove'; from: PeerId; trackId: string}
  | {type: 'move'; from: PeerId; trackId: string; rank: string; moved: Stamp}
  | {type: 'playback'; from: PeerId; playback: PlaybackWire}
  | {type: 'chat'; from: PeerId; name: string; id: string; text: string}
  | {type: 'ping'; from: PeerId; to: PeerId; t0: number}
  | {type: 'pong'; from: PeerId; to: PeerId; t0: number}
  | {type: 'bye'; from: PeerId}

/** Mensaje a enviar. `relay: false` = solo por el camino directo. */
export interface Outgoing {
  msg: RoomMessage
  relay: boolean
}

export interface VideoMeta {
  videoId: string
  title: string
  author: string
}
