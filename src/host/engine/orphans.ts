import {execFile} from 'node:child_process'
import {readdir, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {PROFILE_PREFIX, profileHostPid} from './profile'

/**
 * Restos de motores anteriores: navegadores huérfanos (su host de extensiones murió sin pararlos)
 * y carpetas de perfil que nadie borró. Se limpian al abrir una sala.
 *
 * Solo cuenta como huérfano un proceso cuya línea de órdenes lleva la ruta completa de un perfil
 * del motor en el almacenamiento global de esta extensión (`<globalStorage>/engine-profile-<pid>…`):
 * el navegador normal del usuario nunca la lleva. Y aun así se respetan los motores de las demás
 * ventanas de VS Code (comparten globalStorage): solo se mata si el host dueño del perfil soy yo
 * (al abrir una sala no tengo motor en marcha) o ya no existe.
 */

export interface ProcessInfo {
  pid: number
  command: string
  /** Solo en Windows: quién lo lanzó (para saber quién relanzó el navegador). */
  parentPid?: number
  parentName?: string
}

export interface Ownership {
  /** pid de este host de extensiones. */
  ownPid: number
  isAlive: (pid: number) => boolean
}

export interface OrphanQuery extends Ownership {
  /** Carpeta de almacenamiento global de la extensión. */
  root: string
  /** true en Windows: las rutas no distinguen mayúsculas. */
  ignoreCase: boolean
}

/** Salida de `Get-CimInstance … | Select-Object ProcessId,CommandLine | ConvertTo-Json`. */
export function parseWindowsProcesses(json: string): ProcessInfo[] {
  const text = json.trim()
  if (text === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  // ConvertTo-Json da un objeto suelto si solo hay un proceso.
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const processes: ProcessInfo[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const pid: unknown = Reflect.get(row, 'ProcessId')
    const command: unknown = Reflect.get(row, 'CommandLine')
    if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 && typeof command === 'string') {
      const parentPid: unknown = Reflect.get(row, 'ParentProcessId')
      const parentName: unknown = Reflect.get(row, 'ParentName')
      processes.push({
        pid,
        command,
        ...(typeof parentPid === 'number' && Number.isSafeInteger(parentPid) ? {parentPid} : {}),
        ...(typeof parentName === 'string' && parentName !== '' ? {parentName} : {})
      })
    }
  }
  return processes
}

/** Salida de `ps -ax -o pid=,command=`. */
export function parsePsProcesses(text: string): ProcessInfo[] {
  const processes: ProcessInfo[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    if (Number.isSafeInteger(pid) && pid > 0) processes.push({pid, command: match[2] ?? ''})
  }
  return processes
}

/** El perfil es de un host que ya no está, o mío (y entonces no lo usa ningún motor en marcha). */
function abandoned(hostPid: number, owner: Ownership): boolean {
  return hostPid === owner.ownPid || !owner.isAlive(hostPid)
}

/** pids de los navegadores huérfanos con un perfil del motor de esta extensión. */
export function findOrphans(processes: ProcessInfo[], query: OrphanQuery): number[] {
  const fold = (text: string): string => (query.ignoreCase ? text.toLowerCase() : text)
  const needle = fold(join(query.root, PROFILE_PREFIX))
  const orphans: number[] = []
  for (const {pid, command} of processes) {
    if (pid === query.ownPid) continue
    const haystack = fold(command)
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      const digits = /^\d+/.exec(haystack.slice(at + needle.length))
      const hostPid = digits === null ? undefined : Number(digits[0])
      if (hostPid !== undefined && hostPid > 0 && abandoned(hostPid, query)) {
        orphans.push(pid)
        break
      }
      at = haystack.indexOf(needle, at + needle.length)
    }
  }
  return orphans
}

/**
 * Los procesos de un navegador con exactamente ese perfil (`--user-data-dir=<dir>`, con o sin
 * comillas). Tras un traspaso, el navegador relanzado no es hijo nuestro: solo se le encuentra así.
 */
export function findHolders(processes: ProcessInfo[], profileDir: string, ignoreCase: boolean): ProcessInfo[] {
  const fold = (text: string): string => (ignoreCase ? text.toLowerCase() : text)
  const needle = fold(profileDir)
  return processes.filter(({command}) => {
    const haystack = fold(command)
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      // Que sea la carpeta entera y no el principio de otra (`…-0a1b2c3d-other`).
      if (!/[\w.-]/.test(haystack.charAt(at + needle.length))) return true
    }
    return false
  })
}

/** Para el registro: cuántos procesos tienen el perfil y quién lanzó el navegador principal. */
export function describeHolders(holders: ProcessInfo[]): string {
  if (holders.length === 0) return 'no process holds the engine profile'
  const count = holders.length === 1 ? '1 process holds' : `${holders.length} processes hold`
  // El proceso del navegador es el único sin `--type=` (los demás son sus hijos: renderer, gpu…).
  const browser = holders.find(holder => !holder.command.includes('--type=')) ?? holders[0]
  if (browser === undefined) return `${count} the engine profile`
  const parent = browser.parentName === undefined ? 'unknown' : `${browser.parentName} (${browser.parentPid ?? '?'})`
  return `${count} the engine profile; browser ${browser.pid} started by ${parent}`
}

/** Carpetas de perfil (nombres dentro de globalStorage) que ya no usa nadie. */
export function staleProfiles(names: string[], owner: Ownership): string[] {
  return names.filter(name => {
    const hostPid = profileHostPid(name)
    return hostPid !== undefined && abandoned(hostPid, owner)
  })
}

/** El proceso existe (EPERM: existe pero no es nuestro). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

const LIST_TIMEOUT_MS = 5000
/** Columna calculada con el nombre del proceso padre (vacía si ya no existe). */
const PARENT_NAME = "@{n='ParentName';e={(Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue).ProcessName}}"

/**
 * Los procesos cuya línea de órdenes contiene `like` (por defecto, cualquier perfil del motor; en
 * Windows ya filtrados por WQL y con su proceso padre; en el resto, todos). Rechaza si la orden
 * falla o tarda más de `timeoutMs`.
 */
export function listProcesses(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = LIST_TIMEOUT_MS,
  like: string = PROFILE_PREFIX
): Promise<ProcessInfo[]> {
  if (platform === 'win32') {
    // UTF-8 para que una ruta con acentos (C:\Users\José\…) llegue igual que la que se compara.
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      // Las comillas romperían el filtro WQL: «_» es el comodín de un carácter.
      `Get-CimInstance Win32_Process -Filter "CommandLine like '%${like.replace(/['"]/g, '_')}%'" | Select-Object ProcessId,ParentProcessId,CommandLine,${PARENT_NAME} | ConvertTo-Json -Compress`
    ].join('; ')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], timeoutMs).then(
      parseWindowsProcesses
    )
  }
  return run('ps', ['-ax', '-o', 'pid=,command='], timeoutMs).then(parsePsProcesses)
}

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8'},
      (error, stdout) => (error === null ? resolve(stdout) : reject(error))
    )
  })
}

export interface CleanupOptions extends Ownership {
  root: string
  ignoreCase: boolean
  list: () => Promise<ProcessInfo[]>
  kill: (pid: number) => void
  /** Perfiles que no se tocan aunque parezcan abandonados (el del motor que se esté lanzando). */
  inUse: (name: string) => boolean
  log: (text: string) => void
}

/** Mata los huérfanos y borra los perfiles abandonados. Nunca rechaza: los fallos se registran. */
export async function cleanupLeftovers(options: CleanupOptions): Promise<void> {
  try {
    const orphans = findOrphans(await options.list(), options)
    let killed = 0
    for (const pid of orphans) {
      try {
        options.kill(pid)
        killed++
      } catch (error) {
        options.log(`could not stop orphaned engine process ${pid} (${errorText(error)})`)
      }
    }
    if (orphans.length > 0) options.log(`stopped ${killed} orphaned engine process${killed === 1 ? '' : 'es'}`)
  } catch (error) {
    options.log(`could not look for orphaned engines (${errorText(error)})`)
  }
  let names: string[]
  try {
    names = await readdir(options.root)
  } catch {
    return // sin carpeta de almacenamiento no hay perfiles que borrar
  }
  const stale = staleProfiles(names, options).filter(name => !options.inUse(name))
  const results = await Promise.all(
    stale.map(name =>
      rm(join(options.root, name), {recursive: true, force: true, maxRetries: 3, retryDelay: 200}).then(
        () => true,
        () => false
      )
    )
  )
  const removed = results.filter(Boolean).length
  if (stale.length > 0) options.log(`removed ${removed} of ${stale.length} stale engine profile${stale.length === 1 ? '' : 's'}`)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
