import * as vscode from 'vscode'
import {formatRoomCode, normalizeRoomCode} from '../core/ids'
import {ResolveError} from '../resolve/youtube'
import type {RoomController} from './controller'

const t = vscode.l10n.t

function resolveErrorText(error: unknown): string {
  const code = error instanceof ResolveError ? error.code : 'network'
  switch (code) {
    case 'invalid-link':
      return t('That is not a YouTube video or playlist link.')
    case 'not-found':
      return t('YouTube has no video or playlist at that link.')
    case 'not-embeddable':
      return t('That video cannot be played outside YouTube.')
    case 'network':
      return t('Could not reach YouTube. Check your connection and try again.')
  }
}

/** Lo que el usuario puede hacer. Lo usan por igual los comandos y la vista lateral. */
export class Actions {
  constructor(private readonly controller: RoomController) {}

  async create(): Promise<void> {
    await this.controller.enter()
  }

  async join(code?: string): Promise<void> {
    const invalid = t('A room code has 8 letters and digits, like ABCD-2345.')
    const typed =
      code ??
      (await vscode.window.showInputBox({
        title: t('Room code'),
        placeHolder: 'ABCD-2345',
        validateInput: value => (normalizeRoomCode(value) === undefined ? invalid : undefined)
      }))
    if (typed === undefined) return
    const normalized = normalizeRoomCode(typed)
    if (normalized === undefined) {
      void vscode.window.showWarningMessage(invalid)
      return
    }
    await this.controller.enter(normalized)
  }

  async leave(): Promise<void> {
    await this.controller.leave()
  }

  async addLink(url?: string): Promise<void> {
    const session = this.controller.session
    if (session === undefined) {
      void vscode.window.showWarningMessage(t('Join or create a room first.'))
      return
    }
    const input = url ?? (await vscode.window.showInputBox({title: t('YouTube video or playlist link')}))
    if (input === undefined || input.trim() === '') return
    try {
      const result = await session.addLink(input)
      if (result.added === 0) void vscode.window.showWarningMessage(t('The queue is full.'))
      else if (result.truncated) {
        void vscode.window.showInformationMessage(
          t('Added the first {0} videos. Longer playlists are not supported yet.', result.added)
        )
      }
    } catch (error) {
      void vscode.window.showWarningMessage(resolveErrorText(error))
    }
  }

  togglePlay(): void {
    this.controller.session?.togglePlay()
  }

  next(): void {
    this.controller.session?.next()
  }

  playNow(trackId: string): void {
    this.controller.session?.playNow(trackId)
  }

  remove(trackId: string): void {
    this.controller.session?.remove(trackId)
  }

  seek(positionS: number): void {
    if (Number.isFinite(positionS)) this.controller.session?.seek(positionS)
  }

  setVolume(value: number): void {
    if (Number.isFinite(value)) this.controller.setVolume(value)
  }

  async togglePlayer(): Promise<void> {
    await this.controller.togglePlayer()
  }

  showLog(): void {
    this.controller.showLog()
  }

  async copyCode(): Promise<void> {
    const state = this.controller.viewState()
    if (!state.inRoom) return
    const code = formatRoomCode(state.room.code)
    await vscode.env.clipboard.writeText(code)
    vscode.window.setStatusBarMessage(t('Room code {0} copied.', code), 3000)
  }
}

export function registerCommands(actions: Actions): vscode.Disposable[] {
  const handlers: Record<string, () => unknown> = {
    'syncroom.createRoom': () => actions.create(),
    'syncroom.joinRoom': () => actions.join(),
    'syncroom.leaveRoom': () => actions.leave(),
    'syncroom.addLink': () => actions.addLink(),
    'syncroom.togglePlay': () => actions.togglePlay(),
    'syncroom.next': () => actions.next(),
    'syncroom.togglePlayer': () => actions.togglePlayer(),
    'syncroom.copyCode': () => actions.copyCode(),
    'syncroom.showLog': () => actions.showLog()
  }
  return Object.entries(handlers).map(([command, handler]) => vscode.commands.registerCommand(command, handler))
}
