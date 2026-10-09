import type {Listed} from '../core/types'
import type {DirectoryView} from '../host/discovery/directory'
import type {RoomView} from '../host/session'

/** La lista del lobby y tus grupos (palabras guardadas en este equipo). */
export type LobbyView = DirectoryView & {groups: string[]}

/** Solo para el dueño con la sala listada. `relaysOk: null` = aún no salió el primer anuncio. */
export interface ListingView {
  relaysOk: number | null
  group: string | null
}

export type ViewState =
  | {inRoom: false; directory: LobbyView}
  | {inRoom: true; room: RoomView; playerVisible: boolean; listing: ListingView | undefined; groups: string[]}

/** Del extension host a la vista lateral. */
export type HostToWebview = {t: 'state'; state: ViewState}

/** De la vista lateral al extension host. */
export type WebviewToHost =
  | {t: 'ready'}
  | {t: 'create'}
  | {t: 'join'; code: string}
  | {t: 'leave'}
  | {t: 'add'; url: string}
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
