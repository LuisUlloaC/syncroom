import type {Listed} from '../core/types'
import type {DirectoryView} from '../host/discovery/directory'
import type {RoomView} from '../host/session'
import type {SearchResult} from '../resolve/search'
import type {RtcSignal} from './bridge'

/** La lista del lobby y tus grupos (palabras guardadas en este equipo). */
export type LobbyView = DirectoryView & {groups: string[]}

/** Solo para el dueño con la sala listada. `relaysOk: null` = aún no salió el primer anuncio. */
export interface ListingView {
  relaysOk: number | null
  group: string | null
}

export type ViewState =
  | {inRoom: false; directory: LobbyView}
  /** `videoPreview`: el ajuste del usuario (la vista previa puede estar parada aunque sea true). */
  | {inRoom: true; room: RoomView; playerVisible: boolean; listing: ListingView | undefined; groups: string[]; videoPreview: boolean}

/** Del extension host a la vista lateral. */
export type HostToWebview =
  | {t: 'state'; state: ViewState}
  /** Señalización de la vista previa, reenviada desde el motor. */
  | {t: 'rtc'; signal: RtcSignal}
  /** El motor dejó de capturar: volver a la miniatura. */
  | {t: 'previewEnd'}
  /** Respuesta a `search` con el mismo `id`; `error` ya va traducido. */
  | {t: 'searchResults'; id: number; results: SearchResult[]; error: string | null}

/** De la vista lateral al extension host. */
export type WebviewToHost =
  | {t: 'ready'}
  | {t: 'create'}
  /** `fromList`: elegida en «Salas abiertas» (se entra solo por relays: el dueño es un desconocido). */
  | {t: 'join'; code: string; fromList?: boolean}
  | {t: 'leave'}
  /** `next`: que suene justo después de la pista actual. */
  | {t: 'add'; url: string; next?: boolean}
  /** Buscar vídeos en YouTube; el `id` empareja la respuesta y descarta las viejas. */
  | {t: 'search'; id: number; query: string}
  | {t: 'toggle'}
  | {t: 'next'}
  | {t: 'playNow'; trackId: string}
  | {t: 'remove'; trackId: string}
  | {t: 'seek'; positionS: number}
  | {t: 'volume'; value: number}
  | {t: 'copyCode'}
  | {t: 'togglePlayer'}
  | {t: 'rename'; name: string}
  /** Colocar entre `beforeId` (delante; null = principio) y `afterId` (detrás; null = final). */
  | {t: 'move'; trackId: string; beforeId: string | null; afterId: string | null}
  | {t: 'playNext'; trackId: string}
  | {t: 'say'; text: string}
  | {t: 'locks'; lockQueue: boolean; lockPlayback: boolean}
  /** Con 'group', `group` es la palabra del grupo. */
  | {t: 'listed'; listed: Listed; group?: string}
  | {t: 'hide'; code: string; owner: boolean}
  | {t: 'unhideAll'}
  /** El host pide la palabra; con `thenList` la sala pasa a ese grupo. */
  | {t: 'addGroup'; thenList: boolean}
  | {t: 'removeGroup'; word: string}
  /** Respuesta y candidatos de la vista previa, para el motor. */
  | {t: 'rtc'; signal: RtcSignal}
  /** Encender o apagar la vista previa (ajuste del usuario). */
  | {t: 'videoPreview'; on: boolean}
