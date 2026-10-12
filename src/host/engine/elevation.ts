import {execFile} from 'node:child_process'

/**
 * Si este host corre como administrador (solo Windows; en el resto, undefined). `net session`
 * solo funciona elevado. Es para el registro: los navegadores se relanzan solos si van elevados.
 */
export function isElevated(platform: NodeJS.Platform = process.platform): Promise<boolean | undefined> {
  if (platform !== 'win32') return Promise.resolve(undefined)
  return new Promise(resolve => {
    execFile('net', ['session'], {timeout: 5000, windowsHide: true}, error => resolve(error === null))
  })
}
