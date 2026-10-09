/** Temporizadores inyectables: en las pruebas se avanzan a mano. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface Clock {
  /** Milisegundos, como Date.now(). */
  now(): number
  readonly timers: Timers
}

export const systemClock: Clock = {
  now: () => Date.now(),
  timers: {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined)
  }
}
