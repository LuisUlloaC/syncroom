import {mkdir, rm} from 'node:fs/promises'
import {userInfo} from 'node:os'
import {join} from 'node:path'
import * as vscode from 'vscode'
import {generatePeerId, generateRoomCode} from '../core/ids'
import {DEFAULT_RELAYS} from '../protocol/defaults'
import type {ViewState} from '../protocol/webview'
import {resolveLink} from '../resolve/youtube'
import {BridgeServer} from './bridge-server'
import {locateBrowser} from './engine/browser-locator'
import {EngineProcess, buildEngineArgs} from './engine/engine-process'
import {RoomSession} from './session'

const t = vscode.l10n.t

const MAX_NAME = 40
const DEFAULT_VOLUME = 60
/** Margen para que el «bye» salga antes de matar el motor. */
const GOODBYE_MS = 300
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000

interface ActiveRoom {
  session: RoomSession
  bridge: BridgeServer
  engine: EngineProcess
  profileDir: string
  visible: boolean
  /** true mientras somos nosotros quienes cerramos el motor. */
  expectedExit: boolean
  /** true mientras se está relanzando tras un fallo. */
  restarting: boolean
  restarts: number[]
  reportedFault: string | undefined
}

/** Ciclo de vida de la sala dentro de VS Code: como mucho una sala por ventana. */
export class RoomController implements vscode.Disposable {
  private active: ActiveRoom | undefined
  private busy = false
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private readonly output = vscode.window.createOutputChannel('SyncRoom')

  constructor(private readonly context: vscode.ExtensionContext) {}

  get session(): RoomSession | undefined {
    return this.active?.session
  }

  viewState(): ViewState {
    const room = this.active
    if (room === undefined) return {inRoom: false}
    return {inRoom: true, room: room.session.view(), playerVisible: room.visible}
  }

  /** Entra en la sala `code`, o crea una nueva si no se da código. */
  async enter(code?: string): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.leave()
      await this.open(code ?? generateRoomCode())
    } finally {
      this.busy = false
    }
  }

  async leave(): Promise<void> {
    const room = this.active
    if (room === undefined) return
    this.active = undefined
    room.expectedExit = true
    this.log('leaving the room')
    room.session.dispose()
    await new Promise(done => setTimeout(done, GOODBYE_MS))
    await room.engine.stop()
    await room.bridge.close()
    // El perfil es desechable: así nunca queda un navegador «restaurando» sesiones anteriores.
    await rm(room.profileDir, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}).catch(() => undefined)
    await vscode.commands.executeCommand('setContext', 'syncroom.inRoom', false)
    this.changed.fire()
  }

  /** Alterna entre motor oculto y mini ventana. Reinicia el navegador; la sala sigue en memoria. */
  async togglePlayer(): Promise<void> {
    const room = this.active
    if (room === undefined || this.busy) return
    this.busy = true
    try {
      room.expectedExit = true
      await room.engine.stop()
      room.expectedExit = false
      if (this.active !== room) return
      room.visible = !room.visible
      this.launch(room)
      this.changed.fire()
    } finally {
      this.busy = false
    }
  }

  setVolume(value: number): void {
    const session = this.active?.session
    if (session === undefined) return
    session.setVolume(value)
    void this.context.globalState.update('volume', session.view().volume)
  }

  showLog(): void {
    this.output.show(true)
  }

  dispose(): void {
    void this.leave()
    this.changed.dispose()
    this.output.dispose()
  }

  private log(text: string): void {
    this.output.appendLine(`${new Date().toISOString().slice(11, 19)} ${text}`)
  }

  private async open(code: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('syncroom')
    const configured = config.get<string>('browserPath', '').trim()
    const browser = await locateBrowser({configured})
    this.log(`room ${code}: browser ${browser ?? 'NOT FOUND'}${configured !== '' ? ' (configured)' : ''}`)
    if (browser === undefined) {
      await this.reportMissingBrowser(configured !== '')
      return
    }
    const name = await this.ensureName(config)
    if (name === undefined) return

    // Un perfil por ventana de VS Code: Chromium solo admite un proceso por perfil.
    const profileDir = join(this.context.globalStorageUri.fsPath, `engine-profile-${process.pid}`)
    await mkdir(profileDir, {recursive: true})
    const bridge = await BridgeServer.start({pageDir: join(this.context.extensionPath, 'dist', 'engine')})
    const session = new RoomSession({
      code,
      peerId: generatePeerId(),
      name,
      direct: config.get<boolean>('directConnections', true),
      relays: config.get<string[]>('relays', DEFAULT_RELAYS),
      volume: this.context.globalState.get<number>('volume', DEFAULT_VOLUME),
      link: bridge,
      resolve: input => resolveLink(input),
      log: text => this.log(text)
    })
    const room: ActiveRoom = {
      session,
      bridge,
      engine: new EngineProcess(browser),
      profileDir,
      visible: false,
      expectedExit: false,
      restarting: false,
      restarts: [],
      reportedFault: undefined
    }
    this.active = room
    session.onChange(() => {
      const fault = session.view().fault
      if (fault !== undefined && fault !== room.reportedFault) {
        room.reportedFault = fault
        this.log(`fault reported: ${fault}`)
        void vscode.window.showWarningMessage(t('SyncRoom could not load the YouTube player. Check that youtube.com is reachable from this computer, then run "SyncRoom: Show Log".'))
      }
      this.changed.fire()
    })
    room.engine.onExit(() => {
      this.log(`engine process exited${room.expectedExit ? ' (expected)' : ''}`)
      void this.onEngineTrouble(room)
    })
    session.onEngineFailure(() => void this.onEngineTrouble(room))
    session.start()
    this.launch(room)
    await vscode.commands.executeCommand('setContext', 'syncroom.inRoom', true)
    this.changed.fire()
  }

  private launch(room: ActiveRoom): void {
    const args = buildEngineArgs({url: room.bridge.pageUrl, profileDir: room.profileDir, visible: room.visible})
    this.log(`launching engine (${room.visible ? 'window' : 'hidden'}): ${args.map(a => a.replace(/t=[0-9a-f]+/, 't=…')).join(' ')}`)
    room.engine.start(args)
    room.session.expectEngine()
  }

  /**
   * El motor falló: el proceso terminó (el usuario cerró la mini ventana, el navegador murió),
   * la página perdió el canal, o nunca llegó a decir «ready». Se relanza en modo oculto,
   * con un presupuesto de reintentos para no quedarse en bucle.
   */
  private async onEngineTrouble(room: ActiveRoom): Promise<void> {
    if (this.active !== room || room.expectedExit || room.restarting) return
    room.restarting = true
    try {
      const now = Date.now()
      room.restarts = [...room.restarts.filter(at => now - at < RESTART_WINDOW_MS), now]
      this.log(`engine trouble: restart ${room.restarts.length}/${MAX_RESTARTS}`)
      if (room.restarts.length > MAX_RESTARTS) {
        this.log('giving up: leaving the room')
        void vscode.window.showErrorMessage(t('The audio engine keeps failing. Check that YouTube is reachable, then try again.'))
        await this.leave()
        return
      }
      room.expectedExit = true
      await room.engine.stop()
      room.expectedExit = false
      if (this.active !== room) return
      room.visible = false
      this.launch(room)
      this.changed.fire()
    } finally {
      room.restarting = false
    }
  }

  private async reportMissingBrowser(wasConfigured: boolean): Promise<void> {
    const openSettings = t('Open Settings')
    const message = wasConfigured
      ? t('The browser set in "syncroom.browserPath" was not found.')
      : t('SyncRoom needs Microsoft Edge, Google Chrome, Brave or Chromium to play audio, and none was found.')
    const choice = await vscode.window.showErrorMessage(message, openSettings)
    if (choice === openSettings) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'syncroom.browserPath')
    }
  }

  private async ensureName(config: vscode.WorkspaceConfiguration): Promise<string | undefined> {
    const saved = config.get<string>('displayName', '').trim()
    if (saved !== '') return saved.slice(0, MAX_NAME)
    const typed = await vscode.window.showInputBox({
      title: t('Your name in the room'),
      prompt: t('Shown to the other people in the room.'),
      value: systemUserName(),
      validateInput: value =>
        value.trim() === '' || value.trim().length > MAX_NAME ? t('Enter a name of up to 40 characters.') : undefined
    })
    const name = typed?.trim() ?? ''
    if (name === '') return undefined
    await config.update('displayName', name, vscode.ConfigurationTarget.Global)
    return name
  }
}

function systemUserName(): string {
  try {
    return userInfo().username.slice(0, MAX_NAME)
  } catch {
    return ''
  }
}
