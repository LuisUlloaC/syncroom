import type {RoomView} from '../session'

/**
 * Mi sala está listada en un grupo cuya palabra ya no tengo (la quité, o reclamé la sala en otra sesión):
 * no puedo anunciarla, así que pasa a privada.
 */
export function needsDemotion(view: Pick<RoomView, 'code' | 'policy'>, hasGroupFor: (code: string) => boolean): boolean {
  const policy = view.policy
  return policy?.mine === true && policy.listed === 'group' && !hasGroupFor(view.code)
}
