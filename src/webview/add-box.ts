import {parseYouTubeLink} from '../resolve/links'

export type AddIntent = {kind: 'empty'} | {kind: 'link'} | {kind: 'search'; query: string}

/** Una sola palabra con pinta de dirección (dominio con punto y ruta): no se busca, se trata como enlace. */
const LOOKS_LIKE_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|[\w-]+(?:\.[\w-]+)+\/\S*)$/i

/**
 * Qué hacer con lo escrito en la caja: un enlace de YouTube (o algo que parece una dirección,
 * para que el host diga que no es de YouTube) se añade; cualquier otro texto se busca.
 */
export function addIntent(input: string): AddIntent {
  const trimmed = input.trim()
  if (trimmed === '') return {kind: 'empty'}
  if (parseYouTubeLink(trimmed) !== undefined || LOOKS_LIKE_URL.test(trimmed)) return {kind: 'link'}
  return {kind: 'search', query: trimmed}
}
