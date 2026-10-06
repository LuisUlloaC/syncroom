export type PlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

export interface PlayerStatus {
  /** Vídeo cargado en el reproductor, o null si no hay ninguno. */
  videoId: string | null
  state: PlayerState
  timeS: number
  durationS: number
}

export type PlayerCommand =
  | {type: 'load'; videoId: string; startS: number; playing: boolean}
  | {type: 'play'}
  | {type: 'pause'}
  | {type: 'seek'; timeS: number}
  | {type: 'stop'}

export interface Desired {
  videoId: string | null
  playing: boolean
  positionS: number
}

/** Órdenes mínimas para que el reproductor haga lo que la sala quiere. */
export function reconcile(desired: Desired, status: PlayerStatus, toleranceS: number): PlayerCommand[] {
  if (desired.videoId === null) return status.videoId === null ? [] : [{type: 'stop'}]

  if (status.videoId !== desired.videoId) {
    return [{type: 'load', videoId: desired.videoId, startS: desired.positionS, playing: desired.playing}]
  }

  // Mientras carga no se le dan más órdenes: se volverá a comparar con el siguiente estado.
  if (status.state === 'buffering') return []

  // Un vídeo preparado y en pausa ya está donde debe; moverlo lo haría arrancar.
  const idle = status.state === 'cued' || status.state === 'unstarted'
  if (!desired.playing && idle) return []

  if (status.state === 'ended') {
    const finished = status.durationS > 0 && desired.positionS >= status.durationS - 1
    if (!desired.playing || finished) return []
    return [{type: 'seek', timeS: desired.positionS}, {type: 'play'}]
  }

  const commands: PlayerCommand[] = []
  if (Math.abs(status.timeS - desired.positionS) > toleranceS) {
    commands.push({type: 'seek', timeS: desired.positionS})
  }
  if (desired.playing && status.state !== 'playing') commands.push({type: 'play'})
  if (!desired.playing && status.state === 'playing') commands.push({type: 'pause'})
  return commands
}
