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
  order: Stamp
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

export type Via = 'direct' | 'relay'

export type RoomMessage =
  | {type: 'hello'; from: PeerId; name: string; digest: string}
  | {type: 'state'; from: PeerId; name: string; tracks: Track[]; removed: string[]; playback: PlaybackWire}
  | {type: 'add'; from: PeerId; tracks: Track[]}
  | {type: 'remove'; from: PeerId; trackId: string}
  | {type: 'playback'; from: PeerId; playback: PlaybackWire}
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
