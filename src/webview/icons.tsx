const PATHS = {
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 2.5h3v11H4zM9 2.5h3v11H9z',
  next: 'M3 2.5v11l7-5.5zM11 2.5h2v11h-2z',
  trash: 'M6 2h4l.6 1H13v1.5H3V3h2.4zM4 6h8l-.6 8H4.6z',
  leave: 'M2.5 2H9v1.5H4v9h5V14H2.5zM10.6 4.9l3.1 3.1-3.1 3.1-1-1 1.4-1.4H6V7.3h5L9.6 5.9z',
  volume: 'M2 6h2.6L8 3v10L4.6 10H2zM10 5.2c1.5.9 1.5 4.7 0 5.6z',
  window: 'M2 3h12v10H2zm1.5 3v5.5h9V6z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({name}: {name: IconName}) {
  return (
    <svg class="ico" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d={PATHS[name]} />
    </svg>
  )
}
