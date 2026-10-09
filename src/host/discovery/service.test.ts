import type * as vscode from 'vscode'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {FakeNet} from './testing'

const vscodeMock = vi.hoisted(() => {
  class EventEmitter<T> {
    private listeners: ((value: T) => void)[] = []
    readonly event = (listener: (value: T) => void) => {
      this.listeners.push(listener)
      return {dispose: () => undefined}
    }
    fire(value?: T): void {
      for (const listener of this.listeners) listener(value as T)
    }
    dispose(): void {
      this.listeners = []
    }
  }
  return {
    l10n: {t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]))},
    EventEmitter,
    window: {showInputBox: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn()},
    workspace: {getConfiguration: () => ({get: (_key: string, fallback: unknown) => fallback})}
  }
})
vi.mock('vscode', () => vscodeMock)

const netMock = vi.hoisted(() => ({createNostrNet: vi.fn()}))
vi.mock('./nostr-net', () => netMock)

const {Discovery} = await import('./service')

function setup(secrets: {get: (key: string) => Promise<string | undefined>; store: (key: string, value: string) => Promise<void>}) {
  const logs: string[] = []
  const context = {
    globalState: {get: (_key: string, fallback: unknown) => fallback, update: () => Promise.resolve()},
    secrets
  } as unknown as vscode.ExtensionContext
  const discovery = new Discovery(context, text => logs.push(text))
  return {discovery, logs}
}

const ticks = (): Promise<void> => new Promise(done => setTimeout(done, 20))

describe('Discovery when VS Code fails it', () => {
  let nets: FakeNet[]

  beforeEach(() => {
    nets = []
    netMock.createNostrNet.mockImplementation(() => {
      const net = new FakeNet()
      nets.push(net)
      return net
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('without secret storage it uses a key for this session only, no saved groups, and logs why', async () => {
    const {discovery, logs} = setup({
      get: () => Promise.reject(new Error('keyring locked')),
      store: () => Promise.reject(new Error('keyring locked'))
    })
    await vi.waitFor(() => expect(netMock.createNostrNet).toHaveBeenCalledTimes(1))
    const secret: unknown = netMock.createNostrNet.mock.calls[0]?.[1]
    expect(secret).toBeInstanceOf(Uint8Array)
    expect((secret as Uint8Array).length).toBe(32)
    expect(logs.join('\n')).toContain('secret storage unavailable')
    expect(logs.join('\n')).toContain('could not read the saved groups')
    expect(discovery.groupWords()).toEqual([])
    expect(discovery.directoryView().status).toBe('searching')
    discovery.dispose()
  })

  it('when the relays cannot be set up the lobby says offline instead of searching forever', async () => {
    netMock.createNostrNet.mockImplementation(() => {
      throw new Error('no WebSocket')
    })
    const {discovery, logs} = setup({get: () => Promise.resolve(undefined), store: () => Promise.resolve()})
    await vi.waitFor(() => expect(discovery.directoryView().status).toBe('offline'))
    expect(logs.join('\n')).toContain('no WebSocket')
    discovery.dispose()
  })

  it('a group that cannot be saved shows an error and is not added', async () => {
    const {discovery} = setup({
      get: () => Promise.resolve(undefined),
      store: key => (key === 'syncroom.groups' ? Promise.reject(new Error('keyring locked')) : Promise.resolve())
    })
    vscodeMock.window.showInputBox.mockResolvedValue('Motorflash Front')
    await expect(discovery.addGroup()).resolves.toBeUndefined()
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith('Could not save the group. keyring locked')
    expect(discovery.groupWords()).toEqual([])
    discovery.dispose()
  })

  it('a group that cannot be removed shows an error and stays', async () => {
    const {discovery} = setup({
      get: key => Promise.resolve(key === 'syncroom.groups' ? '["motorflash front"]' : undefined),
      store: key => (key === 'syncroom.groups' ? Promise.reject(new Error('keyring locked')) : Promise.resolve())
    })
    vscodeMock.window.showWarningMessage.mockResolvedValue('Remove')
    await expect(discovery.removeGroup('motorflash front')).resolves.toBeUndefined()
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith('Could not save the group. keyring locked')
    expect(discovery.groupWords()).toEqual(['motorflash front'])
    discovery.dispose()
  })

  it('disposed before it finished loading, it never opens the relays', async () => {
    let release: (value: string | undefined) => void = () => undefined
    const {discovery} = setup({
      get: () => new Promise(done => (release = done)),
      store: () => Promise.resolve()
    })
    discovery.dispose()
    release(undefined)
    await ticks()
    expect(netMock.createNostrNet).not.toHaveBeenCalled()
  })
})
