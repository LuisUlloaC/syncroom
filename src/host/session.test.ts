import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {RoomState} from '../core/room-state'
import type {PlayerCommand, PlayerStatus} from '../core/sync'
import type {RoomMessage, VideoMeta} from '../core/types'
import type {EngineLink, EngineToHost, HostToEngine} from '../protocol/bridge'
import {RoomSession, type SessionOptions} from './session'

class FakeLink implements EngineLink {
  sent: HostToEngine[] = []
  private listener: ((msg: EngineToHost) => void) | undefined

  send(msg: HostToEngine): void {
    this.sent.push(msg)
  }
  onMessage(listener: (msg: EngineToHost) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  }
  emit(msg: EngineToHost): void {
    this.listener?.(msg)
  }
  private lost: (() => void) | undefined
  onDisconnect(listener: () => void): () => void {
    this.lost = listener
    return () => {
      this.lost = undefined
    }
  }
  drop(): void {
    this.lost?.()
  }
  take(): HostToEngine[] {
    const sent = this.sent
    this.sent = []
    return sent
  }
}

const FIRST: VideoMeta = {videoId: 'aaaaaaaaaaa', title: 'First', author: 'A'}
const SECOND: VideoMeta = {videoId: 'bbbbbbbbbbb', title: 'Second', author: 'B'}

function setup(over: Partial<SessionOptions> = {}) {
  const link = new FakeLink()
  const session = new RoomSession({
    code: 'ABCD2345',
    peerId: 'me',
    name: 'Me',
    direct: true,
    relays: ['wss://relay.example'],
    volume: 60,
    link,
    resolve: async () => ({metas: [FIRST], truncated: false, startIndex: 0}),
    ...over
  })
  session.start()
  return {link, session}
}

const twoTracks = {resolve: async () => ({metas: [FIRST, SECOND], truncated: false, startIndex: 0})}

const playing = (videoId: string, timeS: number): PlayerStatus => ({videoId, state: 'playing', timeS, durationS: 200})

const commands = (sent: HostToEngine[]): PlayerCommand[] => sent.flatMap(m => (m.t === 'player' ? [m.cmd] : []))
const roomMessages = (sent: HostToEngine[]): RoomMessage[] => sent.flatMap(m => (m.t === 'send' ? [m.msg] : []))
const sends = (sent: HostToEngine[]): Array<[string, boolean]> =>
  sent.flatMap(m => (m.t === 'send' ? [[m.msg.type, m.relay] as [string, boolean]] : []))

function remotePeer(id: string): RoomState {
  return new RoomState({peerId: id, name: id.toUpperCase(), now: () => Date.now()})
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('engine lifecycle', () => {
  it('does not talk to the engine before it is ready', async () => {
    const {link, session} = setup()
    await session.addLink('x')
    vi.advanceTimersByTime(20_000)
    expect(link.sent).toEqual([])
    expect(session.view().tracks).toHaveLength(1)
    expect(session.view().engineReady).toBe(false)
  })

  it('joins the room and loads the current track when the engine is ready', async () => {
    const {link, session} = setup()
    await session.addLink('x')
    link.emit({t: 'ready'})
    const sent = link.take()
    expect(sent[0]).toEqual({t: 'join', code: 'ABCD2345', direct: true, relays: ['wss://relay.example']})
    expect(sent[1]).toEqual({t: 'volume', value: 60})
    expect(sends(sent)).toEqual([['hello', true]])
    expect(commands(sent)).toEqual([{type: 'load', videoId: 'aaaaaaaaaaa', startS: 0, playing: true}])
    expect(session.view().engineReady).toBe(true)
  })

  it('rejoins and reloads after the engine restarts', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    vi.advanceTimersByTime(42_000)
    link.take()

    link.emit({t: 'ready'})
    const sent = link.take()
    expect(sent[0]).toMatchObject({t: 'join', code: 'ABCD2345'})
    expect(sends(sent)).toEqual([['hello', true]])
    const [load] = commands(sent)
    expect(load).toMatchObject({type: 'load', videoId: 'aaaaaaaaaaa', playing: true})
    expect(load?.type === 'load' ? load.startS : -1).toBeCloseTo(42, 1)
  })

  it('says goodbye and stops ticking on dispose', () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    session.dispose()
    const sent = link.take()
    expect(sends(sent)).toEqual([['bye', true]])
    expect(sent.at(-1)).toEqual({t: 'leave'})
    vi.advanceTimersByTime(60_000)
    link.emit({t: 'ready'})
    expect(link.take()).toEqual([])
  })
})

describe('queue and playback', () => {
  it('adding a link broadcasts it and loads it', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    expect(await session.addLink('https://youtu.be/aaaaaaaaaaa')).toEqual({added: 1, truncated: false})
    const sent = link.take()
    expect(sends(sent)).toEqual([
      ['add', true],
      ['playback', true]
    ])
    expect(commands(sent)).toEqual([{type: 'load', videoId: 'aaaaaaaaaaa', startS: 0, playing: true}])
  })

  it('a resolver failure adds nothing and reaches the caller', async () => {
    const {link, session} = setup({
      resolve: async () => {
        throw new Error('invalid-link')
      }
    })
    link.emit({t: 'ready'})
    link.take()
    await expect(session.addLink('nope')).rejects.toThrow('invalid-link')
    expect(session.view().tracks).toEqual([])
    expect(link.take()).toEqual([])
  })

  it('toggles pause for everyone and pauses the player', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    link.take()
    session.togglePlay()
    const sent = link.take()
    expect(roomMessages(sent)).toHaveLength(1)
    expect(roomMessages(sent)[0]).toMatchObject({type: 'playback', playback: {playing: false}})
    expect(commands(sent)).toEqual([{type: 'pause'}])
    expect(session.view().playback.playing).toBe(false)
  })

  it('seeks the player when someone seeks', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    link.take()
    session.seek(90)
    expect(commands(link.take())).toEqual([{type: 'seek', timeS: 90}])
  })

  it('plays a chosen track, skips and removes', async () => {
    const {link, session} = setup(twoTracks)
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.take()
    const [first, second] = session.view().tracks
    session.playNow(second?.id ?? '')
    expect(commands(link.take())).toEqual([{type: 'load', videoId: 'bbbbbbbbbbb', startS: 0, playing: true}])
    session.remove(second?.id ?? '')
    expect(session.view().tracks.map(t => t.id)).toEqual([first?.id])
    expect(commands(link.take())).toEqual([{type: 'stop'}])
    session.togglePlay()
    expect(commands(link.take())).toEqual([{type: 'load', videoId: 'aaaaaaaaaaa', startS: 0, playing: true}])
    session.next()
    expect(session.view().playback.trackId).toBeNull()
  })

  it('moves on when the player reports the end of the current video', async () => {
    const {link, session} = setup(twoTracks)
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.take()
    link.emit({t: 'ended', videoId: 'zzzzzzzzzzz'})
    expect(link.take()).toEqual([])
    link.emit({t: 'ended', videoId: 'aaaaaaaaaaa'})
    const sent = link.take()
    expect(sends(sent)).toEqual([['playback', true]])
    expect(commands(sent)).toEqual([{type: 'load', videoId: 'bbbbbbbbbbb', startS: 0, playing: true}])
  })

  it('marks an unplayable video for this user only', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.take()
    link.emit({t: 'error', videoId: 'aaaaaaaaaaa', code: 999})
    expect(session.view().tracks[0]?.unplayable).toBe(false)
    link.emit({t: 'error', videoId: 'aaaaaaaaaaa', code: 150})
    const sent = link.take()
    expect(session.view().tracks[0]?.unplayable).toBe(true)
    expect(commands(sent)).toEqual([{type: 'stop'}])
    expect(roomMessages(sent)).toEqual([])
    vi.advanceTimersByTime(5000)
    expect(commands(link.take())).toEqual([])
  })
})

describe('engine diagnostics', () => {
  it('forwards engine log lines and records a fault in the view', () => {
    const lines: string[] = []
    const {link, session} = setup({log: text => lines.push(text)})
    link.emit({t: 'log', text: 'page loaded'})
    link.emit({t: 'fault', code: 'youtube-unreachable'})
    link.emit({t: 'ready'})
    expect(lines.some(l => l.includes('page loaded'))).toBe(true)
    expect(lines.some(l => l.includes('youtube-unreachable'))).toBe(true)
    expect(session.view().fault).toBe('youtube-unreachable')
    expect(session.view().engineReady).toBe(true)
  })

  it('clears the fault when a new engine comes up healthy', () => {
    const {link, session} = setup()
    link.emit({t: 'fault', code: 'youtube-unreachable'})
    link.emit({t: 'ready'})
    link.drop()
    link.emit({t: 'ready'})
    expect(session.view().fault).toBeUndefined()
  })
})

describe('engine watchdog', () => {
  it('reports a failure when the engine never says ready', () => {
    const {session} = setup()
    const failed = vi.fn()
    session.onEngineFailure(failed)
    session.expectEngine()
    vi.advanceTimersByTime(19_000)
    expect(failed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it('does not complain when ready arrives in time', () => {
    const {link, session} = setup()
    const failed = vi.fn()
    session.onEngineFailure(failed)
    session.expectEngine()
    vi.advanceTimersByTime(5000)
    link.emit({t: 'ready'})
    vi.advanceTimersByTime(60_000)
    expect(failed).not.toHaveBeenCalled()
  })

  it('reports a failure and stops talking when the link drops after ready', () => {
    const {link, session} = setup()
    const failed = vi.fn()
    session.onEngineFailure(failed)
    session.expectEngine()
    link.emit({t: 'ready'})
    link.take()
    link.drop()
    expect(failed).toHaveBeenCalledTimes(1)
    expect(session.view().engineReady).toBe(false)
    session.togglePlay()
    vi.advanceTimersByTime(10_000)
    expect(link.take()).toEqual([])
  })

  it('ignores a drop while nothing was ready', () => {
    const {link, session} = setup()
    const failed = vi.fn()
    session.onEngineFailure(failed)
    link.drop()
    expect(failed).not.toHaveBeenCalled()
  })
})

describe('drift', () => {
  it('reconciles as soon as the player reports a change of state', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    session.togglePlay()
    link.take()
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0.5)})
    expect(commands(link.take())).toEqual([{type: 'pause'}])
  })

  it('corrects drift on the periodic check but tolerates small differences', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    link.take()
    vi.advanceTimersByTime(5000)
    expect(commands(link.take())).toEqual([{type: 'seek', timeS: 5}])
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 9)})
    vi.advanceTimersByTime(5000)
    expect(commands(link.take())).toEqual([])
  })

  it('ignores a stale status right after loading another video', async () => {
    const {link, session} = setup(twoTracks)
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 3)})
    session.next()
    link.take()
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 4)})
    vi.advanceTimersByTime(5000)
    expect(commands(link.take())).toEqual([])
    expect(session.playerStatus()?.videoId).toBe('bbbbbbbbbbb')
  })
})

describe('network', () => {
  it('applies room messages and answers newcomers with the state', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    const other = remotePeer('other')
    for (const o of [...other.join(), ...other.addTracks([SECOND])]) link.emit({t: 'msg', msg: o.msg, via: 'direct'})
    expect(session.view().tracks.map(t => t.videoId)).toEqual(['bbbbbbbbbbb'])
    const afterOther = link.take()
    expect(sends(afterOther)).toEqual([['state', true]])
    const [load] = commands(afterOther)
    expect(load).toMatchObject({type: 'load', videoId: 'bbbbbbbbbbb', playing: true})

    const late = remotePeer('late')
    for (const o of late.join()) link.emit({t: 'msg', msg: o.msg, via: 'relay'})
    expect(sends(link.take())).toEqual([['state', true]])
    expect(session.view().peers.map(p => p.name)).toEqual(['Me', 'LATE', 'OTHER'])
  })

  it('ignores malformed network messages', () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    link.emit({t: 'msg', msg: null, via: 'relay'})
    link.emit({t: 'msg', msg: 'boom', via: 'direct'})
    link.emit({t: 'msg', msg: {type: 'add', from: 'x', tracks: [{id: 1}]}, via: 'relay'})
    link.emit({t: 'msg', msg: {type: 'playback', from: 'x', playback: {positionS: 'NaN'}}, via: 'relay'})
    expect(session.view().tracks).toEqual([])
    expect(session.view().peers).toHaveLength(1)
    expect(link.take()).toEqual([])
  })

  it('sends heartbeats, relay beacons and pings on schedule', () => {
    const {link} = setup()
    link.emit({t: 'ready'})
    for (const o of remotePeer('other').join()) link.emit({t: 'msg', msg: o.msg, via: 'relay'})
    link.take()
    vi.advanceTimersByTime(5000)
    expect(sends(link.take())).toEqual([['hello', false]])
    vi.advanceTimersByTime(5000)
    expect(sends(link.take())).toEqual([
      ['hello', false],
      ['ping', false]
    ])
    vi.advanceTimersByTime(5000)
    expect(sends(link.take())).toEqual([['hello', true]])
  })

  it('expires peers that go silent', () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    for (const o of remotePeer('other').join()) link.emit({t: 'msg', msg: o.msg, via: 'relay'})
    expect(session.view().peers).toHaveLength(2)
    vi.advanceTimersByTime(40_000)
    expect(session.view().peers).toHaveLength(1)
  })
})

describe('view', () => {
  it('describes the room for the interface', async () => {
    const {link, session} = setup()
    const listener = vi.fn()
    session.onChange(listener)
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    link.emit({t: 'net', directPeers: 2, relaysOk: 4})
    vi.advanceTimersByTime(3000)
    const view = session.view()
    expect(view.code).toBe('ABCD2345')
    expect(view.me).toEqual({id: 'me', name: 'Me'})
    expect(view.tracks).toEqual([
      {id: view.tracks[0]?.id, videoId: 'aaaaaaaaaaa', title: 'First', author: 'A', addedBy: 'Me', current: true, unplayable: false}
    ])
    expect(view.playback.trackId).toBe(view.tracks[0]?.id)
    expect(view.playback.playing).toBe(true)
    expect(view.playback.positionS).toBeCloseTo(3, 1)
    expect(view.playback.durationS).toBe(200)
    expect(view.net).toEqual({directPeers: 2, relaysOk: 4})
    expect(listener).toHaveBeenCalled()
  })

  it('never reports a position beyond the duration', async () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    await session.addLink('x')
    link.emit({t: 'status', status: playing('aaaaaaaaaaa', 0)})
    vi.advanceTimersByTime(4000)
    link.emit({t: 'status', status: {videoId: 'aaaaaaaaaaa', state: 'buffering', timeS: 0, durationS: 2}})
    expect(session.view().playback.positionS).toBe(2)
  })

  it('clamps and forwards the volume', () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    session.setVolume(130)
    expect(session.view().volume).toBe(100)
    session.setVolume(-5)
    expect(session.view().volume).toBe(0)
    expect(link.take()).toEqual([
      {t: 'volume', value: 100},
      {t: 'volume', value: 0}
    ])
  })
})

describe('renaming', () => {
  it('rename trims, limits to 40 characters, tells the room and ignores empty names', () => {
    const {link, session} = setup()
    link.emit({t: 'ready'})
    link.take()
    session.rename('  Luis  ')
    expect(session.view().me.name).toBe('Luis')
    expect(sends(link.take())).toEqual([['hello', true]])
    session.rename('x'.repeat(50))
    expect(session.view().me.name).toBe('x'.repeat(40))
    session.rename('   ')
    expect(session.view().me.name).toBe('x'.repeat(40))
    expect(sends(link.take())).toEqual([['hello', true]])
  })

  it('rename before the engine is ready still changes the name shown', () => {
    const {link, session} = setup()
    session.rename('Early')
    expect(session.view().me.name).toBe('Early')
    expect(link.take()).toEqual([])
  })
})

describe('command/status feedback', () => {
  // Imita el ida y vuelta real por loopback: cada orden provoca un «status» ~1 ms después,
  // y YouTube aún no ha reaccionado (sigue en el estado anterior).
  function slowPlayer(link: FakeLink) {
    let real: PlayerStatus = NOTHING
    const original = link.send.bind(link)
    link.send = (msg: HostToEngine) => {
      original(msg)
      if (msg.t !== 'player') return
      if (msg.cmd.type === 'load') real = {videoId: msg.cmd.videoId, state: 'unstarted', timeS: 0, durationS: 0}
      const snapshot = real
      setTimeout(() => link.emit({t: 'status', status: snapshot}), 1)
    }
    return {
      becomes(status: PlayerStatus) {
        real = status
        link.emit({t: 'status', status})
      }
    }
  }
  const NOTHING: PlayerStatus = {videoId: null, state: 'unstarted', timeS: 0, durationS: 0}

  it('does not hammer the player while YouTube is still reacting to the last command', async () => {
    const {link, session} = setup()
    slowPlayer(link)
    let emits = 0
    session.onChange(() => (emits += 1))
    link.emit({t: 'ready'})
    await session.addLink('x')
    await vi.advanceTimersByTimeAsync(1000)
    // Carga y, al ver el vídeo sin arrancar, un único «play»; nada más hasta que el reproductor cambie.
    expect(commands(link.take()).map(c => c.type)).toEqual(['load', 'play'])
    expect(emits).toBeLessThan(20)
  })

  it('retries on the periodic check if the player still disagrees', async () => {
    const {link, session} = setup()
    slowPlayer(link)
    link.emit({t: 'ready'})
    await session.addLink('x')
    await vi.advanceTimersByTimeAsync(1000)
    link.take()
    await vi.advanceTimersByTimeAsync(5000)
    // Han pasado 6 s de sala y el reproductor sigue en 0: salto y «play», una sola vez.
    expect(commands(link.take()).map(c => c.type)).toEqual(['seek', 'play'])
  })

  it('reacts at once to a real change of state after a command', async () => {
    const {link, session} = setup()
    const player = slowPlayer(link)
    link.emit({t: 'ready'})
    await session.addLink('x')
    await vi.advanceTimersByTimeAsync(50)
    link.take()
    player.becomes({videoId: 'aaaaaaaaaaa', state: 'cued', timeS: 0, durationS: 200})
    expect(commands(link.take()).map(c => c.type)).toEqual(['play'])
  })

  it('still reacts at once to a user action right after a command', async () => {
    const {link, session} = setup()
    const player = slowPlayer(link)
    link.emit({t: 'ready'})
    await session.addLink('x')
    await vi.advanceTimersByTimeAsync(50)
    player.becomes(playing('aaaaaaaaaaa', 0.1))
    link.take()
    session.togglePlay()
    expect(commands(link.take())).toEqual([{type: 'pause'}])
  })
})
