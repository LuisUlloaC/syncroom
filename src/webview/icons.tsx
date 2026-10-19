const PATHS = {
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 2.5h3v11H4zM9 2.5h3v11H9z',
  next: 'M3 2.5v11l7-5.5zM11 2.5h2v11h-2z',
  trash: 'M6 2h4l.6 1H13v1.5H3V3h2.4zM4 6h8l-.6 8H4.6z',
  leave: 'M2.5 2H9v1.5H4v9h5V14H2.5zM10.6 4.9l3.1 3.1-3.1 3.1-1-1 1.4-1.4H6V7.3h5L9.6 5.9z',
  volume: 'M2 6h2.6L8 3v10L4.6 10H2zM10 5.2c1.5.9 1.5 4.7 0 5.6z',
  window: 'M2 3h12v10H2zm1.5 3v5.5h9V6z',
  /** Renglones con un play: lista de reproducción. */
  playlist: 'M2 3h10v1.5H2zm0 3.5h10V8H2zM2 10h5.5v1.5H2zm7.5-.5v5l4.5-2.5z',
  /** Cámara: vídeo en la vista. */
  video: 'M1.5 4h9v8h-9zM11.5 7l3-2v6l-3-2z',
  /** Flecha hacia arriba hasta una línea: «a continuación». */
  up: 'M3 2h10v1.5H3zM8 4.5l4 4-1.06 1.06L8.75 7.37V14h-1.5V7.37L5.06 9.56 4 8.5z',
  grip: 'M6 3h1.5v1.5H6zm2.5 0H10v1.5H8.5zM6 7.25h1.5v1.5H6zm2.5 0H10v1.5H8.5zM6 11.5h1.5V13H6zm2.5 0H10V13H8.5z',
  send: 'M2 2l12 6-12 6 1.5-4.8L9 8 3.5 6.8z',
  lock: 'M4 7V5a4 4 0 0 1 8 0v2h1v7H3V7zm1.5 0h5V5a2.5 2.5 0 0 0-5 0z',
  unlock: 'M4 7V5a4 4 0 0 1 7.8-1.2l-1.4.6A2.5 2.5 0 0 0 5.5 5v2H13v7H3V7z',
  plus: 'M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z',
  check: 'M6.2 11.6 2.8 8.2l1.06-1.06 2.34 2.34 5.94-5.94 1.06 1.06z',
  close: 'M4.1 3.04 8 6.94l3.9-3.9 1.06 1.06L9.06 8l3.9 3.9-1.06 1.06L8 9.06l-3.9 3.9-1.06-1.06L6.94 8l-3.9-3.9z',
  /** Tres puntos: menú de más acciones. */
  more: 'M3 7h2v2H3zm4 0h2v2H7zm4 0h2v2h-2z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({name}: {name: IconName}) {
  return (
    <svg class="ico" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d={PATHS[name]} />
    </svg>
  )
}
