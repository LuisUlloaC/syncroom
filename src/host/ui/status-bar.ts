import * as vscode from 'vscode'
import {formatRoomCode} from '../../core/ids'
import type {RoomController} from '../controller'

const t = vscode.l10n.t
const MAX_TITLE = 40

export function createStatusBar(controller: RoomController): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  item.command = 'syncroom.togglePlay'
  item.tooltip = t('Click to play or pause')

  const update = (): void => {
    const state = controller.viewState()
    if (!state.inRoom) {
      item.hide()
      return
    }
    const current = state.room.tracks.find(track => track.current)
    const title = current === undefined ? t('Room {0}', formatRoomCode(state.room.code)) : current.title
    const short = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title
    const icon = current === undefined ? 'broadcast' : state.room.playback.playing ? 'play' : 'debug-pause'
    const text = `$(${icon}) ${short}`
    // Solo se toca si cambia: el estado llega cada segundo y reescribirlo hace parpadear la barra.
    if (item.text !== text) item.text = text
    item.show()
  }

  const subscription = controller.onDidChange(update)
  update()
  return vscode.Disposable.from(item, subscription)
}
