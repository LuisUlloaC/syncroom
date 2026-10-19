import {mkdir, rm} from 'node:fs/promises'
import {homedir, release, userInfo} from 'node:os'
import {basename, join} from 'node:path'
import * as vscode from 'vscode'
import {generatePeerId, generateRoomCode} from '../core/ids'
import {DEFAULT_RELAYS} from '../protocol/defaults'
import type {Listed, Locks} from '../core/types'
import type {RtcSignal} from '../protocol/bridge'
import type {ViewState} from '../protocol/webview'
import {resolveLink} from '../resolve/youtube'
import {BridgeServer} from './bridge-server'
import {LOG_LINES, issueUrl, redactLine} from './bug-report'
import {needsDemotion} from './discovery/demotion'
import {Discovery} from './discovery/service'
import {locateBrowser} from './engine/browser-locator'
import {isElevated} from './engine/elevation'
import {EngineProcess, buildEngineArgs, describeExit, profileHolders} from './engine/engine-process'
import {cleanupLeftovers, describeHolders, isAlive, listProcesses} from './engine/orphans'
import {engineProfileName, profileToken} from './engine/profile'
import {planRestart} from './engine/restart-budget'
import {PreviewSwitch} from './preview-switch'
import {MAX_NAME, RoomSession} from './session'

const t = vscode.l10n.t

const DEFAULT_VOLUME = 60
/** Margen para que el «bye» salga antes de matar el motor. */
const GOODBYE_MS = 300
/** Tope de la limpieza de restos al abrir sala: después se entra igual. */
const CLEANUP_MS = 8000
/** Tras un traspaso, espera antes de mirar quién tiene el perfil (el relanzado tarda en abrir). */
const HOLDERS_DELAY_MS = 3000

interface ActiveRoom {
  session: RoomSession
  bridge: BridgeServer
  engine: EngineProcess
  /** Perfil del motor actual; cada lanzamiento estrena uno (undefined antes del primero). */
  profileDir: string | undefined
  visible: boolean
  /** true mientras somos nosotros quienes cerramos el motor. */
  expectedExit: boolean
  /** true mientras se está relanzando tras un fallo. */
  restarting: boolean
  restarts: readonly number[]
  reportedFault: string | undefined
}

/** Ciclo de vida de la sala dentro de VS Code: como mucho una sala por ventana. */
export class RoomController implements vscode.Disposable {
  private active: ActiveRoom | undefined
  private busy = false
  private disposed = false
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private readonly output = vscode.window.createOutputChannel('SyncRoom')
  /** Final del registro, para adjuntarlo al informar de un error (el canal no se puede leer). */
  private readonly recent: string[] = []

  private readonly discovery: Discovery

  /** La vista lateral principal está a la vista y su webview ya escucha. */
  private sidebarVisible = false
  private readonly previewSwitch = new PreviewSwitch()
  private readonly rtc = new vscode.EventEmitter<RtcSignal>()
  /** Señalización de la vista previa que llega del motor, para la vista lateral. */
  readonly onDidRtc = this.rtc.event
  private readonly previewEnd = new vscode.EventEmitter<void>()
  /** La vista previa se paró (o no pudo arrancar): la vista vuelve a la miniatura. */
  readonly onDidPreviewEnd = this.previewEnd.event
  private readonly configWatch: vscode.Disposable

  constructor(private readonly context: vscode.ExtensionContext) {
    this.discovery = new Discovery(context, text => this.log(text))
    this.discovery.onDidChange(() => {
      this.syncDiscovery()
      this.changed.fire()
    })
    this.configWatch = vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('syncroom.videoPreview')) return
      this.syncPreview()
      this.changed.fire()
    })
  }

  get session(): RoomSession | undefined {
    return this.active?.session
  }

  viewState(): ViewState {
    const room = this.active
    if (room === undefined) return {inRoom: false, directory: this.discovery.directoryView()}
    return {
      inRoom: true,
      room: room.session.view(),
      playerVisible: room.visible,
      listing: this.discovery.listing(),
      groups: this.discovery.groupWords(),
      videoPreview: this.videoPreviewEnabled()
    }
  }

  /**
   * Entra en la sala `code`, o crea una nueva (y se hace dueño) si no se da código.
   * `relayOnly`: sin conexión directa en esta sesión, diga lo que diga el ajuste. Para las salas
   * elegidas de la lista: su gente es desconocida y por conexión directa vería tu IP.
   */
  async enter(code?: string, opts: {relayOnly?: boolean} = {}): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.leave()
      await this.open(code ?? generateRoomCode(), code === undefined, opts.relayOnly === true)
    } finally {
      this.busy = false
    }
  }

  /** Bloqueos de la sala (solo el dueño); se recuerdan para la próxima sala que cree. */
  setLocks(locks: Locks): void {
    const session = this.active?.session
    if (session === undefined) return
    session.setLocks(locks)
    const policy = session.view().policy
    if (policy?.mine === true) {
      void this.context.globalState.update('locks', {lockQueue: policy.lockQueue, lockPlayback: policy.lockPlayback})
    }
  }

  /** Solo el dueño: quién puede encontrar la sala. Con 'group', `group` es la palabra del grupo. */
  setListed(listed: Listed, group?: string): void {
    const session = this.active?.session
    if (session === undefined) return
    this.discovery.setRoomGroup(session.view().code, listed === 'group' ? group : undefined)
    session.setListed(listed)
    // Cambiar de un grupo a otro no cambia la política: el anuncio se rehace aquí.
    this.syncDiscovery()
  }

  addGroup(): Promise<string | undefined> {
    return this.discovery.addGroup()
  }

  removeGroup(word: string): Promise<void> {
    return this.discovery.removeGroup(word)
  }

  hide(code: string, owner: boolean): void {
    this.discovery.hide(code, owner)
  }

  unhideAll(): void {
    this.discovery.unhideAll()
  }

  /** La lista del lobby y la vista previa solo funcionan mientras la vista principal se ve. */
  setSidebarVisible(visible: boolean): void {
    this.sidebarVisible = visible
    this.discovery.setLobbyVisible(visible)
    this.syncPreview()
  }

  /** Preferencia de cada usuario (no de la sala): se guarda en sus ajustes globales. */
  async setVideoPreview(on: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('syncroom').update('videoPreview', on, vscode.ConfigurationTarget.Global)
    this.syncPreview()
    this.changed.fire()
  }

  /** Respuesta y candidatos de la vista lateral, para el motor. */
  sendRtc(signal: RtcSignal): void {
    this.active?.bridge.send({t: 'rtc', signal})
  }

  private videoPreviewEnabled(): boolean {
    return vscode.workspace.getConfiguration('syncroom').get<boolean>('videoPreview', true)
  }

  /** Captura en marcha solo con sala, motor listo, vista a la vista y el ajuste activado. */
  private syncPreview(): void {
    const room = this.active
    const on = this.previewSwitch.update({
      inRoom: room !== undefined,
      visible: this.sidebarVisible,
      enabled: this.videoPreviewEnabled(),
      engineReady: room?.session.view().engineReady ?? false
    })
    if (on === undefined) return
    room?.bridge.send({t: 'preview', on: on === 'on'})
    if (on === 'off') this.previewEnd.fire()
  }

  /** La sala propia en la lista: la anuncia o la retira. Listada en un grupo que ya no tengo → privada. */
  private syncDiscovery(): void {
    const session = this.active?.session
    if (session === undefined) return
    const view = session.view()
    const hasGroupFor = (code: string): boolean => this.discovery.hasGroupFor(code)
    if (needsDemotion(view, hasGroupFor)) {
      // Fuera de la pila actual: se llega aquí también en mitad de RoomState.receive (al reclamar la sala).
      queueMicrotask(() => {
        if (this.active?.session !== session || !needsDemotion(session.view(), hasGroupFor)) return
        session.setListed('none') // su onChange vuelve a pasar por aquí
      })
      return
    }
    this.discovery.syncRoom(view)
  }

  /** Clave estable de esta instalación: con ella se reconoce al dueño aunque salga y vuelva. */
  private ownerKey(): string {
    const saved = this.context.globalState.get<string>('ownerKey')
    if (saved !== undefined && saved !== '') return saved
    const fresh = generatePeerId()
    void this.context.globalState.update('ownerKey', fresh)
    return fresh
  }

  /**
   * Sale de la sala y para el motor. `goodbye: false` no espera a que salga el «bye»: el motor se
   * mata en el acto (al desechar el controlador, cuando el host puede no durar ni esos 300 ms).
   */
  async leave(opts: {goodbye?: boolean} = {}): Promise<void> {
    const room = this.active
    if (room === undefined) return
    this.active = undefined
    this.previewSwitch.reset()
    this.previewEnd.fire()
    const retiring = this.discovery.leaveRoom()
    room.expectedExit = true
    this.log('leaving the room')
    room.session.dispose()
    // La vista, la barra de estado y los menús dejan la sala ya: parar el motor tarda segundos.
    void vscode.commands.executeCommand('setContext', 'syncroom.inRoom', false)
    this.changed.fire()
    if (opts.goodbye !== false) await new Promise(done => setTimeout(done, GOODBYE_MS))
    await room.engine.stop()
    await room.bridge.close()
    // El perfil es desechable: así nunca queda un navegador «restaurando» sesiones anteriores.
    if (room.profileDir !== undefined) await removeProfile(room.profileDir)
    await retiring
    this.log('left the room')
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
      await this.launch(room)
      this.changed.fire()
    } finally {
      this.busy = false
    }
  }

  /** Guarda el nombre en los ajustes y, si hay sala, lo cambia en ella. */
  async rename(name: string): Promise<void> {
    const clean = name.trim().slice(0, MAX_NAME)
    if (clean === '') return
    await vscode.workspace.getConfiguration('syncroom').update('displayName', clean, vscode.ConfigurationTarget.Global)
    this.active?.session.rename(clean)
    this.changed.fire()
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

  /**
   * Al cerrar VS Code, deactivate() ya sale de la sala (y VS Code espera). Si aún queda una sala
   * (el host se desecha sin deactivate), el motor se para ya: si no, Edge quedaría huérfano.
   */
  dispose(): void {
    void this.leave({goodbye: false})
    this.disposed = true
    this.discovery.dispose()
    this.configWatch.dispose()
    this.rtc.dispose()
    this.previewEnd.dispose()
    this.changed.dispose()
    this.output.dispose()
  }

  private log(text: string): void {
    // Tras dispose() el canal ya no existe y aún pueden llegar avisos (la salida del motor).
    if (this.disposed) return
    const line = `${new Date().toISOString().slice(11, 19)} ${text}`
    this.output.appendLine(line)
    this.recent.push(line)
    if (this.recent.length > LOG_LINES) this.recent.splice(0, this.recent.length - LOG_LINES)
  }

  /**
   * Abre en el navegador un issue nuevo de GitHub con el entorno y el final del registro (sin el
   * usuario de las rutas ni códigos de sala). El usuario lo revisa y lo envía él.
   */
  async reportBug(title = 'Something went wrong'): Promise<void> {
    const pkg = this.context.extension.packageJSON as {version?: unknown; bugs?: {url?: unknown}}
    const issues = typeof pkg.bugs?.url === 'string' ? pkg.bugs.url : 'https://github.com/LuisUlloaC/syncroom/issues'
    const home = homedir()
    const url = issueUrl({
      newIssueUrl: `${issues}/new`,
      title,
      environment: [
        ['SyncRoom', typeof pkg.version === 'string' ? pkg.version : '?'],
        ['VS Code', `${vscode.version} (${vscode.env.appName})`],
        ['OS', `${process.platform} ${release()} ${process.arch}`],
        ['Remote', vscode.env.remoteName ?? 'none']
      ],
      log: this.recent.map(line => redactLine(line, home))
    })
    this.log('opening a bug report on GitHub')
    await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  /** Aviso de fallo con el botón «Report bug» además de los propios; devuelve el elegido. */
  private async notifyFailure(
    level: 'error' | 'warning',
    message: string,
    issueTitle: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    const report = t('Report bug')
    const choice =
      level === 'error'
        ? await vscode.window.showErrorMessage(message, ...actions, report)
        : await vscode.window.showWarningMessage(message, ...actions, report)
    if (choice !== report) return choice
    await this.reportBug(issueTitle)
    return undefined
  }

  private async open(code: string, claim: boolean, relayOnly: boolean): Promise<void> {
    // En paralelo con lo demás; el motor no arranca hasta que acabe (o pase el tope).
    const cleanup = this.cleanupLeftovers()
    const elevated = isElevated()
    const config = vscode.workspace.getConfiguration('syncroom')
    const configured = config.get<string>('browserPath', '').trim()
    const browser = await locateBrowser({configured})
    this.log(`room ${code}: browser ${browser ?? 'NOT FOUND'}${configured !== '' ? ' (configured)' : ''}`)
    const admin = await elevated
    if (admin !== undefined) this.log(`VS Code running as administrator: ${admin ? 'yes' : 'no'}`)
    if (browser === undefined) {
      await this.reportMissingBrowser(configured !== '')
      return
    }
    const name = await this.ensureName(config)
    if (name === undefined) return
    const direct = !relayOnly && config.get<boolean>('directConnections', true)
    if (relayOnly) this.log(`room ${code}: joined from Open rooms, relays only`)
    await cleanup

    const bridge = await BridgeServer.start({pageDir: join(this.context.extensionPath, 'dist', 'engine')})
    const session = new RoomSession({
      code,
      peerId: generatePeerId(),
      name,
      ownerKey: this.ownerKey(),
      claim,
      initialLocks: this.context.globalState.get<Locks>('locks', {}),
      direct,
      relays: config.get<string[]>('relays', DEFAULT_RELAYS),
      volume: this.context.globalState.get<number>('volume', DEFAULT_VOLUME),
      link: bridge,
      resolve: input => resolveLink(input),
      log: text => this.log(text),
      chatSound: () => vscode.workspace.getConfiguration('syncroom').get<boolean>('chatSound', true)
    })
    const room: ActiveRoom = {
      session,
      bridge,
      engine: new EngineProcess(browser),
      profileDir: undefined,
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
        void this.notifyFailure(
          'warning',
          t('SyncRoom could not load the YouTube player. Check that youtube.com is reachable from this computer, then run "SyncRoom: Show Log".'),
          `The YouTube player could not be loaded (${fault})`
        )
      }
      this.syncDiscovery()
      this.changed.fire()
    })
    room.engine.onHandoff(() => {
      this.log('engine process exited (code 0) before the page connected: the browser relaunched itself; waiting for the page')
      void this.logHolders(room)
    })
    room.engine.onExit(exit => {
      this.log(`engine process exited (${describeExit(exit)})${room.expectedExit ? ' (expected)' : ''}`)
      void this.onEngineTrouble(room)
    })
    session.onEngineFailure(() => void this.onEngineTrouble(room))
    session.start()
    // Después de session.start(): la sesión ve antes el «ready» y ya cuenta el motor como listo.
    bridge.onMessage(msg => {
      if (this.active !== room) return
      if (msg.t === 'rtc') this.rtc.fire(msg.signal)
      else if (msg.t === 'preview') {
        this.log(`preview ${msg.state}${msg.width !== undefined ? ` ${msg.width}x${msg.height ?? '?'}` : ''}`)
        if (msg.state !== 'on') this.previewEnd.fire()
      } else if (msg.t === 'ready') {
        room.engine.markReady()
        this.syncPreview()
      }
    })
    await this.launch(room)
    if (this.active !== room) return
    await vscode.commands.executeCommand('setContext', 'syncroom.inRoom', true)
    this.changed.fire()
  }

  /**
   * Navegadores huérfanos de motores anteriores (su host murió sin pararlos) y perfiles que nadie
   * borró. Nunca falla ni tarda más de CLEANUP_MS: entrar en la sala no depende de esto.
   */
  private cleanupLeftovers(): Promise<void> {
    const work = cleanupLeftovers({
      root: this.context.globalStorageUri.fsPath,
      ownPid: process.pid,
      isAlive,
      ignoreCase: process.platform === 'win32',
      list: () => listProcesses(),
      kill: pid => process.kill(pid, 'SIGKILL'),
      // El perfil del motor que se lance mientras tanto no se toca.
      inUse: name => this.active?.profileDir !== undefined && basename(this.active.profileDir) === name,
      log: text => this.log(text)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<void>(done => (timer = setTimeout(done, CLEANUP_MS)))
    return Promise.race([work, limit]).finally(() => clearTimeout(timer))
  }

  /**
   * Arranca el motor con un perfil estrenado. Se llama con el motor anterior ya parado: su perfil
   * se borra (si un Edge huérfano lo retuviera, el nuevo ni lo toca: Chromium solo admite un
   * navegador por perfil y con el mismo perfil el nuevo saldría al instante).
   */
  private async launch(room: ActiveRoom): Promise<void> {
    const previous = room.profileDir
    const profileDir = join(this.context.globalStorageUri.fsPath, engineProfileName(process.pid, profileToken()))
    room.profileDir = profileDir
    if (previous !== undefined) void removeProfile(previous)
    // Si no se puede crear, que lo intente Chromium (crea la carpeta del perfil si falta).
    await mkdir(profileDir, {recursive: true}).catch((error: unknown) => this.log(`could not create the engine profile (${String(error)})`))
    // Mientras se creaba la carpeta pudo salirse de la sala (y leave() ya borró este perfil).
    if (this.active !== room || room.engine.running) return
    const args = buildEngineArgs({url: room.bridge.pageUrl, profileDir, visible: room.visible})
    this.log(`launching engine (${room.visible ? 'window' : 'hidden'}): ${args.map(a => a.replace(/t=[0-9a-f]+/, 't=…')).join(' ')}`)
    room.engine.start(args, {profileDir})
    room.session.expectEngine()
    // Motor nuevo = página nueva sin captura: se empieza de cero y la vista vuelve a la miniatura.
    this.previewSwitch.reset()
    this.previewEnd.fire()
  }

  /** Tras un traspaso: quién se quedó con el perfil (para saber quién relanzó el navegador). */
  private async logHolders(room: ActiveRoom): Promise<void> {
    const profileDir = room.engine.profile
    if (profileDir === undefined) return
    await new Promise(done => setTimeout(done, HOLDERS_DELAY_MS))
    if (this.active !== room || room.engine.profile !== profileDir) return
    try {
      this.log(describeHolders(await profileHolders(profileDir)))
    } catch (error) {
      this.log(`could not list the engine processes (${error instanceof Error ? error.message : String(error)})`)
    }
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
      const plan = planRestart(room.restarts, Date.now())
      room.restarts = plan.history
      this.log(plan.message)
      if (!plan.restart) {
        void this.notifyFailure(
          'error',
          t('The audio engine keeps failing. Check that YouTube is reachable, then try again.'),
          'The audio engine keeps failing'
        )
        await this.leave()
        return
      }
      room.expectedExit = true
      await room.engine.stop()
      room.expectedExit = false
      if (this.active !== room) return
      room.visible = false
      await this.launch(room)
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
    const choice = await this.notifyFailure('error', message, wasConfigured ? 'The configured browser was not found' : 'No supported browser was found', openSettings)
    if (choice === openSettings) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'syncroom.browserPath')
    }
  }

  /** Pide el nombre con un cuadro de texto; undefined si se cancela. */
  async askName(initial?: string): Promise<string | undefined> {
    const typed = await vscode.window.showInputBox({
      title: t('Your name in the room'),
      prompt: t('Shown to the other people in the room.'),
      value: initial ?? systemUserName(),
      validateInput: value =>
        value.trim() === '' || value.trim().length > MAX_NAME ? t('Enter a name of up to 40 characters.') : undefined
    })
    const name = typed?.trim() ?? ''
    return name === '' ? undefined : name.slice(0, MAX_NAME)
  }

  currentName(): string {
    return vscode.workspace.getConfiguration('syncroom').get<string>('displayName', '').trim().slice(0, MAX_NAME)
  }

  private async ensureName(config: vscode.WorkspaceConfiguration): Promise<string | undefined> {
    const saved = config.get<string>('displayName', '').trim()
    if (saved !== '') return saved.slice(0, MAX_NAME)
    const name = await this.askName()
    if (name === undefined) return undefined
    await config.update('displayName', name, vscode.ConfigurationTarget.Global)
    return name
  }
}

/** Nunca falla: un perfil que no se deja borrar (algún proceso aún lo usa) se queda. */
function removeProfile(dir: string): Promise<void> {
  return rm(dir, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}).catch(() => undefined)
}

function systemUserName(): string {
  try {
    return userInfo().username.slice(0, MAX_NAME)
  } catch {
    return ''
  }
}
