import type {RoomView} from '../host/session'

export type ViewState = {inRoom: false} | {inRoom: true; room: RoomView; playerVisible: boolean}

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
