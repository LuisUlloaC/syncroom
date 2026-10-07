import {randomBytes} from 'node:crypto'
import * as vscode from 'vscode'
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
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    view.webview.options = {enableScripts: true, localResourceRoots: [root]}
    view.webview.html = this.html(view.webview, root)
    view.webview.onDidReceiveMessage((msg: WebviewToHost) => void this.handle(msg))
    view.onDidChangeVisibility(() => this.post())
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
    this.post()
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
        this.post()
        break
      case 'create':
        await this.actions.create()
        break
      case 'join':
        await this.actions.join(msg.code)
        break
      case 'leave':
        await this.actions.leave()
        break
      case 'add':
        await this.actions.addLink(msg.url)
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
