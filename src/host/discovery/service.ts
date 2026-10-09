import {generateSecretKey} from 'nostr-tools/pure'
import * as vscode from 'vscode'
import {hex} from '../../core/crypto'
import {DEFAULT_RELAYS} from '../../protocol/defaults'
import type {ListingView, LobbyView} from '../../protocol/webview'
import type {RoomView} from '../session'
import {PUBLIC_SCOPE, capAnnouncement, groupScope, type Scope} from './announcement'
import {Announcer} from './announcer'
import {systemClock} from './clock'
import {Directory} from './directory'
import {deriveGroupKeys, normalizeGroupWord, type GroupKeys} from './group-key'
import {createNostrNet, type NostrNet} from './nostr-net'
import type {Hidden} from './room-list'

const t = vscode.l10n.t

const NOSTR_KEY = 'syncroom.nostrKey'
const GROUPS = 'syncroom.groups'
const MAX_HIDDEN = 500

/** Salas públicas y de grupo: la lista del lobby y el anuncio de la sala propia. */
export class Discovery implements vscode.Disposable {
  private groups: GroupKeys[] = []
  /** Código de sala → palabra del grupo en que la listé. Solo en memoria: la palabra nunca viaja. */
  private readonly roomGroups = new Map<string, string>()
  private hidden: Hidden
  private net: NostrNet | undefined
  private directory: Directory | undefined
  private announcer: Announcer | undefined
  private lobbyVisible = false
  private lastRoom: RoomView | undefined
  private listingState: ListingView | undefined
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private readonly ready: Promise<void>

  constructor(private readonly context: vscode.ExtensionContext) {
    this.hidden = {
      rooms: context.globalState.get<string[]>('hiddenRooms', []),
      owners: context.globalState.get<string[]>('hiddenOwners', [])
    }
    this.ready = this.load()
  }

  setLobbyVisible(visible: boolean): void {
    this.lobbyVisible = visible
    this.applyActive()
  }

  directoryView(): LobbyView {
    const view = this.directory?.view(this.hidden) ?? {status: 'searching' as const, rooms: [], hiddenCount: 0}
    return {...view, groups: this.groupWords()}
  }

  groupWords(): string[] {
    return this.groups.map(group => group.word)
  }

  listing(): ListingView | undefined {
    return this.listingState
  }

  hasGroupFor(code: string): boolean {
    const word = this.roomGroups.get(code)
    return word !== undefined && this.groups.some(group => group.word === word)
  }

  setRoomGroup(code: string, word: string | undefined): void {
    if (word === undefined) this.roomGroups.delete(code)
    else this.roomGroups.set(code, word)
  }

  /** En cada cambio de la sala (undefined = fuera). Anuncia solo si soy el dueño y está listada. */
  syncRoom(room: RoomView | undefined): void {
    this.lastRoom = room
    this.applyActive()
    const scope = room === undefined ? undefined : this.scopeFor(room)
    const policy = room?.policy
    const snapshot =
      room === undefined || scope === undefined || policy === undefined
        ? undefined
        : capAnnouncement({
            code: room.code,
            owner: room.me.name,
            playing: room.tracks.find(track => track.current)?.title ?? null,
            listeners: room.peers.length,
            locks: {queue: policy.lockQueue, playback: policy.lockPlayback}
          })
    const listed = scope !== undefined && snapshot !== undefined
    const sameScope = this.listingState !== undefined && this.listingState.group === (scope?.group ?? null)
    this.listingState = listed ? {relaysOk: sameScope ? (this.listingState?.relaysOk ?? null) : null, group: scope.group} : undefined
    this.announcer?.update(listed ? scope : undefined, listed ? snapshot : undefined)
  }

  /** Al salir de la sala: retira el anuncio y espera a que salga (con tope). */
  async leaveRoom(): Promise<void> {
    this.syncRoom(undefined)
    await this.announcer?.stop()
  }

  /** Pide la palabra con un cuadro de entrada. Devuelve la palabra normalizada, o undefined si se cancela. */
  async addGroup(): Promise<string | undefined> {
    await this.ready
    const typed = await vscode.window.showInputBox({
      title: t('Group word'),
      prompt: t('Everyone who adds the same word sees the rooms listed for this group. Treat it like a password.'),
      validateInput: value => (normalizeGroupWord(value) === undefined ? t('Use between 8 and 64 characters.') : undefined)
    })
    const word = typed === undefined ? undefined : normalizeGroupWord(typed)
    if (word === undefined) return undefined
    if (!this.groups.some(group => group.word === word)) {
      this.groups = [...this.groups, await deriveGroupKeys(word)]
      await this.saveGroups()
    }
    return word
  }

  async removeGroup(word: string): Promise<void> {
    await this.ready
    const remove = t('Remove')
    const choice = await vscode.window.showWarningMessage(
      t('Remove the group "{0}"? You will stop seeing its rooms.', word),
      {modal: true},
      remove
    )
    if (choice !== remove) return
    this.groups = this.groups.filter(group => group.word !== word)
    await this.saveGroups()
  }

  hide(code: string, owner: boolean): void {
    if (owner) {
      const pubkey = this.directory?.ownerOf(code)
      if (pubkey === undefined) return
      this.hidden = {...this.hidden, owners: [...this.hidden.owners, pubkey].slice(-MAX_HIDDEN)}
    } else {
      this.hidden = {...this.hidden, rooms: [...this.hidden.rooms, code].slice(-MAX_HIDDEN)}
    }
    this.saveHidden()
  }

  unhideAll(): void {
    this.hidden = {rooms: [], owners: []}
    this.saveHidden()
  }

  dispose(): void {
    void this.leaveRoom().finally(() => {
      this.directory?.dispose()
      this.net?.close()
    })
    this.changed.dispose()
  }

  private async load(): Promise<void> {
    let secret = await this.context.secrets.get(NOSTR_KEY)
    if (secret === undefined || !/^[0-9a-f]{64}$/.test(secret)) {
      secret = hex(generateSecretKey())
      await this.context.secrets.store(NOSTR_KEY, secret)
    }
    const relays = vscode.workspace.getConfiguration('syncroom').get<string[]>('relays', DEFAULT_RELAYS)
    const net = createNostrNet(relays, Uint8Array.from(Buffer.from(secret, 'hex')))
    this.net = net
    this.directory = new Directory({net, clock: systemClock, onChange: () => this.changed.fire()})
    this.announcer = new Announcer({
      net,
      clock: systemClock,
      onStatus: relaysOk => {
        if (this.listingState === undefined) return
        this.listingState = {...this.listingState, relaysOk}
        this.changed.fire()
      }
    })
    this.groups = await this.loadGroups()
    this.directory.setScopes(this.scopes())
    // Lo que pasó mientras cargaba: la sala ya abierta y la vista ya visible.
    this.syncRoom(this.lastRoom)
  }

  private async loadGroups(): Promise<GroupKeys[]> {
    let words: unknown
    try {
      words = JSON.parse((await this.context.secrets.get(GROUPS)) ?? '[]')
    } catch {
      words = []
    }
    const valid = (Array.isArray(words) ? words : [])
      .map(word => (typeof word === 'string' ? normalizeGroupWord(word) : undefined))
      .filter((word): word is string => word !== undefined)
    return Promise.all([...new Set(valid)].map(word => deriveGroupKeys(word)))
  }

  private async saveGroups(): Promise<void> {
    await this.context.secrets.store(GROUPS, JSON.stringify(this.groupWords()))
    this.directory?.setScopes(this.scopes())
    this.changed.fire()
  }

  private saveHidden(): void {
    void this.context.globalState.update('hiddenRooms', this.hidden.rooms)
    void this.context.globalState.update('hiddenOwners', this.hidden.owners)
    this.changed.fire()
  }

  private scopes(): Scope[] {
    return [PUBLIC_SCOPE, ...this.groups.map(groupScope)]
  }

  private scopeFor(room: RoomView): Scope | undefined {
    const policy = room.policy
    if (policy?.mine !== true) return undefined
    if (policy.listed === 'global') return PUBLIC_SCOPE
    if (policy.listed !== 'group') return undefined
    const keys = this.groups.find(group => group.word === this.roomGroups.get(room.code))
    return keys === undefined ? undefined : groupScope(keys)
  }

  private applyActive(): void {
    this.directory?.setActive(this.lobbyVisible && this.lastRoom === undefined)
  }
}
