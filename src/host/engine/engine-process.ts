import {spawn, type ChildProcess} from 'node:child_process'
import {basename} from 'node:path'
import treeKill from 'tree-kill'
import {findHolders, listProcesses, type ProcessInfo} from './orphans'

export interface EngineArgsOptions {
  url: string
  profileDir: string
  /** true = mini ventana; false = oculto. */
  visible: boolean
}

/**
 * Chromium no empieza a reproducir en una ventana que nace tapada por otra o fuera de la vista:
 * la da por oculta y aplaza la carga del vídeo para siempre. Con esto la mini ventana cuenta como
 * visible aunque esté tapada. Comprobado con e2e/player-window.e2e.test.ts.
 */
const KEEP_PLAYING_WHEN_COVERED = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
]

/** Parámetros verificados el 2026-10-06 con Edge en Windows. No añadir otros sin probarlos. */
export function buildEngineArgs(options: EngineArgsOptions): string[] {
  const common = [
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    // Vista previa: getDisplayMedia elige sin preguntar la pestaña titulada «SyncRoom» (el <title>
    // de src/engine-page/index.html; si cambia uno, cambia el otro). Probado en oculto el 2026-10-09.
    '--auto-select-tab-capture-source-by-title=SyncRoom',
    // Con VS Code abierto como administrador, Edge se niega a correr elevado: se relanza como
    // usuario normal (fuera de nuestro árbol) y el proceso lanzado sale con código 0. El motor
    // se daba por muerto y los relanzados quedaban huérfanos. Medido el 2026-10-12 con Edge 155
    // elevado: sin esto sale con 0 a los pocos ms; con esto sigue vivo. Sin elevar no cambia nada.
    '--do-not-de-elevate'
  ]
  // El reproductor ocupa toda la página, así que la captura tiene la forma de la página. El Edge
  // oculto resta ~92 px de alto a la ventana (medido el 2026-10-09: 480×270 → página 492×178,
  // vídeo con franjas laterales y 174 px de alto). 480×400 → página 492×308: casi 16:9 y el vídeo
  // entero a 480 de ancho; la vista lateral recorta las franjas que queden (object-fit: cover).
  return options.visible
    ? [...common, `--app=${options.url}`, '--window-size=420,320', ...KEEP_PLAYING_WHEN_COVERED]
    : [...common, '--headless=new', '--window-size=480,400', options.url]
}

/** Cómo terminó el navegador: código, señal o el error al lanzarlo. */
export interface EngineExit {
  code: number | null
  signal: NodeJS.Signals | null
  error?: string
}

/**
 * Códigos de salida de Chromium con explicación. 21 = otro navegador ya tiene el perfil: el nuevo
 * le pasa la orden y sale al instante (reproducido con Edge en oculto: sale a los ~75 ms).
 */
const EXIT_HINTS: ReadonlyMap<number, string> = new Map([[21, 'profile in use']])

/** Para el registro: «code 21: profile in use», «signal SIGKILL», «could not start: …». */
export function describeExit(exit: EngineExit): string {
  if (exit.error !== undefined) return `could not start: ${exit.error}`
  if (exit.code !== null) {
    const hint = EXIT_HINTS.get(exit.code)
    return hint === undefined ? `code ${exit.code}` : `code ${exit.code}: ${hint}`
  }
  return exit.signal !== null ? `signal ${exit.signal}` : 'unknown'
}

export interface EngineProcessOptions {
  /** Mata el proceso y sus hijos (por defecto tree-kill con SIGKILL). */
  killTree?: (pid: number, done: (error?: Error) => void) => void
  /** Tope de espera de stop(); después el proceso se da por perdido. */
  stopTimeoutMs?: number
  /** Los procesos que usan ese perfil (por defecto los busca en el sistema). */
  findHolders?: (profileDir: string) => Promise<ProcessInfo[]>
  /** Mata un proceso suelto (por defecto SIGKILL). */
  killPid?: (pid: number) => void
}

const STOP_TIMEOUT_MS = 5000
/** Buscar los procesos de un perfil puede tardar (WMI); al parar se espera más que al limpiar. */
const HOLDERS_TIMEOUT_MS = 15_000

/** Los procesos del sistema que usan ese perfil del motor. */
export function profileHolders(profileDir: string): Promise<ProcessInfo[]> {
  const windows = process.platform === 'win32'
  return listProcesses(process.platform, HOLDERS_TIMEOUT_MS, basename(profileDir)).then(all => findHolders(all, profileDir, windows))
}

export class EngineProcess {
  private child: ChildProcess | undefined
  private readonly listeners = new Set<(exit: EngineExit) => void>()
  private readonly handoffListeners = new Set<() => void>()
  private readonly killTree: (pid: number, done: (error?: Error) => void) => void
  private readonly stopTimeoutMs: number
  private readonly findHolders: (profileDir: string) => Promise<ProcessInfo[]>
  private readonly killPid: (pid: number) => void
  private profileDir: string | undefined
  /** La página del motor ya habló: a partir de aquí, que el proceso salga es que se cerró. */
  private ready = false
  /** El proceso lanzado salió con 0 dejando el navegador a otro proceso (que no es hijo nuestro). */
  private handedOff = false

  constructor(
    private readonly command: string,
    options: EngineProcessOptions = {}
  ) {
    this.killTree = options.killTree ?? ((pid, done) => treeKill(pid, 'SIGKILL', done))
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
    this.findHolders = options.findHolders ?? profileHolders
    this.killPid = options.killPid ?? (pid => process.kill(pid, 'SIGKILL'))
  }

  get running(): boolean {
    return this.child !== undefined || this.handedOff
  }

  /** Perfil del navegador en marcha (para buscar sus procesos tras un traspaso). */
  get profile(): string | undefined {
    return this.profileDir
  }

  /**
   * `profileDir`: el `--user-data-dir` de este lanzamiento. Con él, una salida con código 0 antes
   * de `markReady()` se toma por traspaso y no por muerte: hay navegadores que se relanzan solos
   * (Edge lo hace si VS Code corre como administrador, y en el log de un usuario lo hacía también
   * sin serlo) y el proceso lanzado sale con 0 en milisegundos mientras el relanzado sigue con
   * nuestro perfil y nuestra página. Si la página nunca llega, ya lo detecta la sesión.
   */
  start(args: string[], opts: {profileDir?: string} = {}): void {
    if (this.running) throw new Error('engine already running')
    this.profileDir = opts.profileDir
    this.ready = false
    // Sin `windowsHide`: en Windows esa opción crea la ventana del navegador oculta, y la mini
    // ventana ni se ve ni reproduce (e2e/player-window.e2e.test.ts). El modo oculto no abre ventana.
    const child = spawn(this.command, args, {stdio: 'ignore'})
    this.child = child
    const finished = (exit: EngineExit): void => {
      if (this.child !== child) return
      this.child = undefined
      if (exit.code === 0 && !this.ready && this.profileDir !== undefined) {
        this.handedOff = true
        for (const listener of this.handoffListeners) listener()
        return
      }
      for (const listener of this.listeners) listener(exit)
    }
    child.once('exit', (code, signal) => finished({code, signal}))
    child.once('error', error => finished({code: null, signal: null, error: error.message}))
  }

  /**
   * Mata el proceso y todos sus hijos (el navegador crea varios). Si matar el árbol falla, mata
   * al menos el proceso principal; si ni así sale a tiempo, lo da por perdido (no se anuncia su
   * salida) para que pueda arrancar otro. Nunca rechaza.
   */
  stop(): Promise<void> {
    if (this.handedOff) return this.stopHolders()
    const child = this.child
    if (child === undefined || child.pid === undefined) return Promise.resolve()
    const pid = child.pid
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.child === child) this.child = undefined
        resolve()
      }, this.stopTimeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.killTree(pid, error => {
        if (error !== undefined && error !== null) child.kill('SIGKILL')
      })
    })
  }

  /** La página del motor dijo «ready»: el navegador es el que lanzamos (o el que lo relevó). */
  markReady(): void {
    this.ready = true
  }

  /** Tras un traspaso no hay hijo que matar: se matan los procesos que tienen nuestro perfil. */
  private async stopHolders(): Promise<void> {
    const profileDir = this.profileDir
    this.handedOff = false
    if (profileDir === undefined) return
    let holders: ProcessInfo[]
    try {
      holders = await this.findHolders(profileDir)
    } catch {
      return // al abrir la próxima sala se limpian como huérfanos
    }
    for (const {pid} of holders) {
      try {
        this.killPid(pid)
      } catch {
        // ya había salido
      }
    }
  }

  /** El proceso lanzado salió con 0 antes de que hablara la página: otro proceso sigue con el perfil. */
  onHandoff(listener: () => void): () => void {
    this.handoffListeners.add(listener)
    return () => {
      this.handoffListeners.delete(listener)
    }
  }

  onExit(listener: (exit: EngineExit) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
