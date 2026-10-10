export const MAX_RESTARTS = 3
export const RESTART_WINDOW_MS = 60_000

export interface RestartPlan {
  /** false = se acabó el presupuesto: hay que rendirse. */
  restart: boolean
  /** Instantes de los reinicios dentro de la ventana, para la próxima vez. */
  history: readonly number[]
  /** Línea para el registro. */
  message: string
}

/**
 * Presupuesto de reinicios del motor: como mucho MAX_RESTARTS en RESTART_WINDOW_MS. Solo se
 * numeran los reinicios de verdad; el fallo que se pasa del presupuesto dice que se rinde.
 */
export function planRestart(history: readonly number[], now: number): RestartPlan {
  const recent = history.filter(at => now - at < RESTART_WINDOW_MS)
  if (recent.length >= MAX_RESTARTS) {
    return {restart: false, history: recent, message: `engine trouble: giving up after ${MAX_RESTARTS} restarts`}
  }
  return {restart: true, history: [...recent, now], message: `engine trouble: restart ${recent.length + 1}/${MAX_RESTARTS}`}
}
