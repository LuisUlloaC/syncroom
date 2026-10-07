import type {ChatLine} from '../session'

/**
 * Mensajes ajenos posteriores a la última línea vista (por clave local). Si esa clave ya no está
 * (el tope de 200 la descartó), cuenta todo: es la opción que no pierde avisos.
 */
export function unreadSince(lines: ChatLine[], seenKey: number | undefined): number {
  const from = seenKey === undefined ? 0 : lines.findIndex(line => line.key === seenKey) + 1
  return lines.slice(from).filter(line => line.kind === 'message' && !line.mine).length
}
