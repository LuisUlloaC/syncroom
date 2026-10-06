import {spawn, type ChildProcess} from 'node:child_process'
import treeKill from 'tree-kill'

export interface EngineArgsOptions {
  url: string
  profileDir: string
  /** true = mini ventana; false = oculto. */
  visible: boolean
}

/** Parámetros verificados el 2026-10-06 con Edge en Windows. No añadir otros sin probarlos. */
export function buildEngineArgs(options: EngineArgsOptions): string[] {
  const common = [
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required'
  ]
  return options.visible
    ? [...common, `--app=${options.url}`, '--window-size=420,320']
    : [...common, '--headless=new', options.url]
}

export class EngineProcess {
  private child: ChildProcess | undefined
  private readonly listeners = new Set<() => void>()

  constructor(private readonly command: string) {}

  get running(): boolean {
    return this.child !== undefined
  }

  start(args: string[]): void {
    if (this.child !== undefined) throw new Error('engine already running')
    const child = spawn(this.command, args, {stdio: 'ignore', windowsHide: true})
    this.child = child
    const finished = (): void => {
      if (this.child !== child) return
      this.child = undefined
      for (const listener of this.listeners) listener()
    }
    child.once('exit', finished)
    child.once('error', finished)
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

  onExit(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
