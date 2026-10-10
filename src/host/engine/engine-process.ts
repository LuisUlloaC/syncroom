import {spawn, type ChildProcess} from 'node:child_process'
import treeKill from 'tree-kill'

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
    '--auto-select-tab-capture-source-by-title=SyncRoom'
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

export class EngineProcess {
  private child: ChildProcess | undefined
  private readonly listeners = new Set<(exit: EngineExit) => void>()

  constructor(private readonly command: string) {}

  get running(): boolean {
    return this.child !== undefined
  }

  start(args: string[]): void {
    if (this.child !== undefined) throw new Error('engine already running')
    // Sin `windowsHide`: en Windows esa opción crea la ventana del navegador oculta, y la mini
    // ventana ni se ve ni reproduce (e2e/player-window.e2e.test.ts). El modo oculto no abre ventana.
    const child = spawn(this.command, args, {stdio: 'ignore'})
    this.child = child
    const finished = (exit: EngineExit): void => {
      if (this.child !== child) return
      this.child = undefined
      for (const listener of this.listeners) listener(exit)
    }
    child.once('exit', (code, signal) => finished({code, signal}))
    child.once('error', error => finished({code: null, signal: null, error: error.message}))
  }

  /** Mata el proceso y todos sus hijos (el navegador crea varios). */
  stop(): Promise<void> {
    const child = this.child
    if (child === undefined || child.pid === undefined) return Promise.resolve()
    const pid = child.pid
    return new Promise(resolve => {
      child.once('exit', () => resolve())
      treeKill(pid, 'SIGKILL', error => {
        if (error) resolve()
      })
    })
  }

  onExit(listener: (exit: EngineExit) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
