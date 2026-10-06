import type {PlayerCommand, PlayerStatus} from '../core/sync'
import type {RoomMessage, Via} from '../core/types'

/** Del extension host a la página del motor. */
export type HostToEngine =
  | {t: 'join'; code: string; direct: boolean; relays: string[]}
  | {t: 'leave'}
  | {t: 'send'; msg: RoomMessage; relay: boolean}
  | {t: 'player'; cmd: PlayerCommand}
  | {t: 'volume'; value: number}

/** De la página del motor al extension host. `msg` llega de la red y aún no está validado. */
export type EngineToHost =
  | {t: 'ready'}
  | {t: 'msg'; msg: unknown; via: Via}
  | {t: 'status'; status: PlayerStatus}
  | {t: 'ended'; videoId: string}
  | {t: 'error'; videoId: string | null; code: number}
  | {t: 'net'; directPeers: number; relaysOk: number}

export interface EngineLink {
  send(msg: HostToEngine): void
  onMessage(listener: (msg: EngineToHost) => void): () => void
  /** La página del motor cerró el canal sin que se lo pidiéramos. */
  onDisconnect?(listener: () => void): () => void
}
