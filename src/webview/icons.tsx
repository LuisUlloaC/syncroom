const PATHS = {
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 2.5h3v11H4zM9 2.5h3v11H9z',
  next: 'M3 2.5v11l7-5.5zM11 2.5h2v11h-2z',
  trash: 'M6 2h4l.6 1H13v1.5H3V3h2.4zM4 6h8l-.6 8H4.6z',
  leave: 'M2.5 2H9v1.5H4v9h5V14H2.5zM10.6 4.9l3.1 3.1-3.1 3.1-1-1 1.4-1.4H6V7.3h5L9.6 5.9z',
  volume: 'M2 6h2.6L8 3v10L4.6 10H2zM10 5.2c1.5.9 1.5 4.7 0 5.6z',
  window: 'M2 3h12v10H2zm1.5 3v5.5h9V6z',
  /** Flecha hacia arriba hasta una línea: «a continuación». */
  up: 'M3 2h10v1.5H3zM8 4.5l4 4-1.06 1.06L8.75 7.37V14h-1.5V7.37L5.06 9.56 4 8.5z',
  grip: 'M6 3h1.5v1.5H6zm2.5 0H10v1.5H8.5zM6 7.25h1.5v1.5H6zm2.5 0H10v1.5H8.5zM6 11.5h1.5V13H6zm2.5 0H10V13H8.5z',
  send: 'M2 2l12 6-12 6 1.5-4.8L9 8 3.5 6.8z',
  chevron: 'M4.5 6l3.5 3.5L11.5 6l1 1-4.5 4.5L3.5 7z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({name}: {name: IconName}) {
  return (
    <svg class="ico" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d={PATHS[name]} />
    </svg>
  )
}
