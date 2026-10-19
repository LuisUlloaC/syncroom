import type {PlayerCommand, PlayerStatus} from '../core/sync'
import type {RoomMessage, Via} from '../core/types'

/** Candidato ICE ya serializado (RTCIceCandidate.toJSON()). */
export interface IceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment?: string | null
}

/** RTCIceCandidate → dato plano que cruza el bridge y el postMessage del webview. */
export function serializeCandidate(candidate: RTCIceCandidate): IceCandidate {
  const json = candidate.toJSON()
  return {
    candidate: json.candidate ?? '',
    sdpMid: json.sdpMid ?? null,
    sdpMLineIndex: json.sdpMLineIndex ?? null,
    usernameFragment: json.usernameFragment ?? null
  }
}

/**
 * Señalización WebRTC de la vista previa (motor ↔ vista lateral, siempre dentro de este equipo).
 * Solo datos planos: los objetos RTC no pasan por el postMessage del webview (DataCloneError).
 */
export type RtcSignal =
  | {kind: 'offer'; sdp: string}
  | {kind: 'answer'; sdp: string}
  | {kind: 'ice'; candidate: IceCandidate}

/** Del extension host a la página del motor. */
export type HostToEngine =
  | {t: 'join'; code: string; direct: boolean; relays: string[]}
  | {t: 'leave'}
  | {t: 'send'; msg: RoomMessage; relay: boolean}
  | {t: 'player'; cmd: PlayerCommand}
  | {t: 'volume'; value: number}
  /** Aviso sonoro corto: llegó un mensaje de chat de otro. */
  | {t: 'chime'}
  /** Empezar o dejar de capturar la pestaña para la vista previa. */
  | {t: 'preview'; on: boolean}
  | {t: 'rtc'; signal: RtcSignal}

/** De la página del motor al extension host. `msg` llega de la red y aún no está validado. */
export type EngineToHost =
  | {t: 'ready'}
  | {t: 'msg'; msg: unknown; via: Via}
  | {t: 'status'; status: PlayerStatus}
  | {t: 'ended'; videoId: string}
  | {t: 'error'; videoId: string | null; code: number}
  | {t: 'net'; directPeers: number; relaysOk: number}
  /** Texto para el registro de diagnóstico. */
  | {t: 'log'; text: string}
  /** El motor funciona pero sin reproductor: YouTube no cargó. */
  | {t: 'fault'; code: 'youtube-unreachable'}
  | {t: 'rtc'; signal: RtcSignal}
  /** Estado de la captura; `unavailable` = el navegador no deja capturar la pestaña. */
  | {t: 'preview'; state: 'on' | 'off' | 'unavailable'; width?: number; height?: number}

export interface EngineLink {
  send(msg: HostToEngine): void
  onMessage(listener: (msg: EngineToHost) => void): () => void
  /** La página del motor cerró el canal sin que se lo pidiéramos. */
  onDisconnect?(listener: () => void): () => void
}
