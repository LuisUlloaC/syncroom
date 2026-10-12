import {randomBytes} from 'node:crypto'
import * as vscode from 'vscode'
import type {RtcSignal} from '../../protocol/bridge'
import type {HostToWebview, ViewState, WebviewToHost} from '../../protocol/webview'
import type {Actions} from '../actions'
import type {RoomController} from '../controller'
import {unreadSince} from './chat-unread'
import {webviewStrings} from './strings'

const t = vscode.l10n.t

/** `room`: la vista principal; `chat`: la del segundo icono, con insignia de no leídos. */
export type SidebarMode = 'room' | 'chat'

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'syncroom.sidebar'
  static readonly chatViewId = 'syncroom.chat'

  private view: vscode.WebviewView | undefined
  /** El webview ya dijo «ready»: antes no escucha y la señalización de la vista previa se perdería. */
  private webviewReady = false
  /** Clave de la última línea de chat que el usuario tuvo a la vista. */
  private seenKey: number | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: RoomController,
    private readonly actions: Actions,
    private readonly mode: SidebarMode = 'room'
  ) {
    controller.onDidChange(() => this.post())
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.webviewReady = false
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    view.webview.options = {enableScripts: true, localResourceRoots: [root]}
    view.webview.html = this.html(view.webview, root)
    view.webview.onDidReceiveMessage((msg: WebviewToHost) => void this.handle(msg))
    this.reportVisibility()
    view.onDidChangeVisibility(() => {
      this.reportVisibility()
      this.post()
    })
    // La vista previa solo va a la vista principal.
    const send = (message: HostToWebview): void => void view.webview.postMessage(message)
    const subscriptions =
      this.mode === 'room'
        ? [
            this.controller.onDidRtc(signal => send({t: 'rtc', signal})),
            this.controller.onDidPreviewEnd(() => send({t: 'previewEnd'}))
          ]
        : []
    view.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose()
      if (this.view === view) this.view = undefined
      this.reportVisibility()
    })
    this.post()
  }

  /** La lista del lobby (relays) y la vista previa (captura) solo funcionan mientras la vista principal se ve. */
  private reportVisibility(): void {
    if (this.mode !== 'room') return
    const view = this.view
    this.controller.setSidebarVisible(view !== undefined && view.visible && this.webviewReady)
  }

  private post(): void {
    const state = this.controller.viewState()
    if (this.mode === 'chat') this.updateBadge(state)
    const message: HostToWebview = {t: 'state', state}
    void this.view?.webview.postMessage(message)
  }

  /** Insignia en el icono de la barra: mensajes ajenos llegados mientras el chat no estaba a la vista. */
  private updateBadge(state: ViewState): void {
    const view = this.view
    if (view === undefined) return
    if (!state.inRoom) {
      this.seenKey = undefined
      view.badge = undefined
      return
    }
    const lines = state.room.chat
    if (view.visible) {
      this.seenKey = lines.at(-1)?.key
      view.badge = undefined
      return
    }
    const unread = unreadSince(lines, this.seenKey)
    view.badge = unread > 0 ? {value: unread, tooltip: t('{0} unread chat messages', unread)} : undefined
  }

  private async handle(msg: WebviewToHost): Promise<void> {
    switch (msg.t) {
      case 'ready':
        // Un webview recién cargado (o recargado) no tiene conexión: apagar y encender la vista
        // previa hace que el motor mande una oferta nueva.
        this.webviewReady = false
        this.reportVisibility()
        this.webviewReady = true
        this.reportVisibility()
        this.post()
        break
      case 'create':
        await this.actions.create()
        break
      case 'join':
        await this.actions.join(msg.code, {fromList: msg.fromList === true})
        break
      case 'leave':
        await this.actions.leave()
        break
      case 'add':
        if (typeof msg.url === 'string') await this.actions.addLink(msg.url, {next: msg.next === true})
        break
      case 'search':
        if (typeof msg.query === 'string' && typeof msg.id === 'number') {
          const reply = await this.actions.search(msg.query)
          const message: HostToWebview = {t: 'searchResults', id: msg.id, ...reply}
          void this.view?.webview.postMessage(message)
        }
        break
      case 'toggle':
        this.actions.togglePlay()
        break
      case 'next':
        this.actions.next()
        break
      case 'playNow':
        this.actions.playNow(msg.trackId)
        break
      case 'remove':
        this.actions.remove(msg.trackId)
        break
      case 'seek':
        this.actions.seek(msg.positionS)
        break
      case 'volume':
        this.actions.setVolume(msg.value)
        break
      case 'copyCode':
        await this.actions.copyCode()
        break
      case 'togglePlayer':
        await this.actions.togglePlayer()
        break
      case 'rename':
        await this.actions.changeName(msg.name)
        break
      case 'move':
        this.actions.move(msg.trackId, msg.beforeId, msg.afterId)
        break
      case 'playNext':
        this.actions.playNext(msg.trackId)
        break
      case 'say':
        this.actions.say(msg.text)
        break
      case 'locks':
        this.actions.setLocks(msg.lockQueue === true, msg.lockPlayback === true)
        break
      case 'listed':
        if (msg.listed === 'none' || msg.listed === 'global' || msg.listed === 'group') {
          this.actions.setListed(msg.listed, typeof msg.group === 'string' ? msg.group : undefined)
        }
        break
      case 'hide':
        if (typeof msg.code === 'string') this.actions.hide(msg.code, msg.owner === true)
        break
      case 'unhideAll':
        this.actions.unhideAll()
        break
      case 'addGroup':
        await this.actions.addGroup(msg.thenList === true)
        break
      case 'removeGroup':
        if (typeof msg.word === 'string') await this.actions.removeGroup(msg.word)
        break
      case 'rtc':
        if (this.mode === 'room' && isViewSignal(msg.signal)) this.actions.sendRtc(msg.signal)
        break
      case 'videoPreview':
        await this.actions.setVideoPreview(msg.on === true)
        break
    }
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.css'))
    const nonce = randomBytes(16).toString('hex')
    // «<» escapado para que ningún texto pueda cerrar la etiqueta <script>.
    const strings = JSON.stringify(webviewStrings()).replace(/</g, '\\u003c')
    const mode = JSON.stringify(this.mode)
    const csp = [
      "default-src 'none'",
      'img-src https://i.ytimg.com',
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ')
    return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__SYNCROOM_STRINGS__ = ${strings}; window.__SYNCROOM_VIEW__ = ${mode}</script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}

/** Lo único que la vista manda al motor: la respuesta y sus candidatos (la oferta sale del motor). */
function isViewSignal(signal: unknown): signal is RtcSignal {
  if (typeof signal !== 'object' || signal === null || !('kind' in signal)) return false
  if (signal.kind === 'answer') return 'sdp' in signal && typeof signal.sdp === 'string'
  if (signal.kind === 'ice') return 'candidate' in signal && typeof signal.candidate === 'object' && signal.candidate !== null
  return false
}
