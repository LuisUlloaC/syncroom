import {hex, importAesKey, stretch} from '../../core/crypto'

export const MIN_GROUP_WORD = 8
export const MAX_GROUP_WORD = 64
/** Distinta de la de las salas: una palabra de grupo nunca coincide con un código de sala. */
const GROUP_SALT = 'syncroom:group:v1'

export interface GroupKeys {
  /** La palabra ya normalizada: es también el nombre que se enseña. */
  word: string
  /** Etiqueta pública con la que se filtran los anuncios del grupo. */
  tag: string
  aesKey: CryptoKey
}

/** La palabra es una contraseña compartida: la etiqueta es pública y se podría atacar por diccionario. */
export function normalizeGroupWord(input: string): string | undefined {
  const word = input.trim().toLowerCase().replace(/\s+/g, ' ')
  return word.length >= MIN_GROUP_WORD && word.length <= MAX_GROUP_WORD ? word : undefined
}

export async function deriveGroupKeys(input: string): Promise<GroupKeys> {
  const word = normalizeGroupWord(input)
  if (word === undefined) throw new Error('invalid group word')
  const bits = await stretch(word, GROUP_SALT, 48)
  return {word, tag: hex(bits.slice(32, 48)), aesKey: await importAesKey(bits.slice(0, 32))}
}
