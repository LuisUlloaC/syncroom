// Imita a un navegador que se relanza solo: arranca el navegador de verdad desvinculado (no queda
// como hijo) y sale con código 0. Uso: node handoff-launcher.mjs <navegador> <args…>
import {spawn} from 'node:child_process'

const [browser, ...args] = process.argv.slice(2)
spawn(browser, args, {detached: true, stdio: 'ignore'}).unref()
setTimeout(() => process.exit(0), 100)
