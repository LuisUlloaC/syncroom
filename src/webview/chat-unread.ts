import type {ChatLine} from '../host/session'

/**
 * Mensajes ajenos posteriores a la última línea vista. Si esa línea ya no está (el tope de 200
 * la descartó), cuenta todo: es la opción que no pierde avisos.
 */
export function unreadSince(lines: ChatLine[], seenId: string | undefined): number {
  const from = seenId === undefined ? 0 : lines.findIndex(line => line.id === seenId) + 1
  return lines.slice(from).filter(line => line.kind === 'message' && !line.mine).length
}
