import {randomBytes} from 'node:crypto'

/**
 * Perfiles del motor: `engine-profile-<pid del host>-<ficha>`, uno nuevo en cada lanzamiento.
 * Chromium solo admite un navegador por perfil: si un Edge huérfano sigue vivo con el perfil que
 * se le pasa al nuevo, el nuevo le cede el turno y sale al instante (código 21). Con una ficha
 * aleatoria por lanzamiento no se repite nunca, ni entre reinicios ni entre hosts con el mismo pid.
 * El pid del host va en el nombre para saber de quién es cada perfil (ver orphans.ts).
 */
export const PROFILE_PREFIX = 'engine-profile-'

export function engineProfileName(hostPid: number, token: string): string {
  return `${PROFILE_PREFIX}${hostPid}-${token}`
}

/** Ficha aleatoria para un lanzamiento: 8 caracteres hexadecimales. */
export function profileToken(): string {
  return randomBytes(4).toString('hex')
}

/**
 * Pid del host dueño de un perfil, o undefined si el nombre no es de un perfil del motor.
 * Acepta también el formato de la 0.7.0 y anteriores (`engine-profile-<pid>`, sin ficha).
 */
export function profileHostPid(name: string): number | undefined {
  const match = /^engine-profile-(\d+)(?:-[0-9a-f]+)?$/.exec(name)
  if (match === null) return undefined
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}
