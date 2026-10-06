import {useEffect, useState} from 'preact/hooks'
import {formatRoomCode} from '../core/ids'
import type {RoomView, TrackView} from '../host/session'
import type {HostToWebview, ViewState, WebviewToHost} from '../protocol/webview'
import {clock, thumbnail} from './format'
import {Icon} from './icons'

declare function acquireVsCodeApi(): {postMessage(message: WebviewToHost): void}

const vscode = acquireVsCodeApi()
const strings = (window as Window & {__SYNCROOM_STRINGS__?: Record<string, string>}).__SYNCROOM_STRINGS__ ?? {}
const s = (key: string): string => strings[key] ?? key
const post = (message: WebviewToHost): void => vscode.postMessage(message)

export function App() {
  const [state, setState] = useState<ViewState>({inRoom: false})

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>): void => {
      if (event.data.t === 'state') setState(event.data.state)
    }
    window.addEventListener('message', onMessage)
    post({t: 'ready'})
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return state.inRoom ? <Room room={state.room} playerVisible={state.playerVisible} /> : <Lobby />
}

function Lobby() {
  const [code, setCode] = useState('')
  return (
    <main class="lobby">
      <h1>{s('lobby.title')}</h1>
      <p>{s('lobby.body')}</p>
      <button class="primary" onClick={() => post({t: 'create'})}>
        {s('lobby.create')}
      </button>
      <form
        class="join"
        onSubmit={event => {
          event.preventDefault()
          if (code.trim() !== '') post({t: 'join', code})
        }}
      >
        <label>
          <span>{s('lobby.joinLabel')}</span>
          <input
            value={code}
            placeholder="ABCD-2345"
            spellcheck={false}
            autocomplete="off"
            onInput={event => setCode(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={code.trim() === ''}>
          {s('lobby.join')}
        </button>
      </form>
    </main>
  )
}

function Room({room, playerVisible}: {room: RoomView; playerVisible: boolean}) {
  const current = room.tracks.find(track => track.current)
  const others = room.peers.filter(peer => peer.id !== room.me.id)
  const link = others.length === 0 ? s('room.alone') : room.net.directPeers > 0 ? s('room.direct') : s('room.relayed')

  return (
    <main class="room">
      <header class="pass">
        <button class="code" onClick={() => post({t: 'copyCode'})} title={s('room.copy')}>
          <span class="label">{s('room.code')}</span>
          <span class="value">{formatRoomCode(room.code)}</span>
        </button>
        <button class="icon" onClick={() => post({t: 'leave'})} title={s('room.leave')} aria-label={s('room.leave')}>
          <Icon name="leave" />
        </button>
      </header>

      <p class="people">
        <span>
          {room.me.name} ({s('room.you')})
          {others.map(peer => `, ${peer.name === '' ? s('room.unnamed') : peer.name}`)}
        </span>
        <span class={room.net.directPeers > 0 ? 'link direct' : 'link'}>{room.engineReady ? link : s('room.starting')}</span>
      </p>

      <section class="now">
        {current === undefined ? (
          <div class="art empty" />
        ) : (
          <img class="art" src={thumbnail(current.videoId)} alt="" />
        )}
        <h2>{current === undefined ? s('player.nothing') : current.title}</h2>
        <p class="by">
          {current === undefined ? s('player.hint') : current.unplayable ? s('player.unplayable') : current.author}
        </p>
        <Scrubber position={room.playback.positionS} duration={room.playback.durationS} />
        <div class="transport">
          <button
            class="icon big"
            disabled={room.tracks.length === 0}
            onClick={() => post({t: 'toggle'})}
            title={room.playback.playing ? s('player.pause') : s('player.play')}
            aria-label={room.playback.playing ? s('player.pause') : s('player.play')}
          >
            <Icon name={room.playback.playing ? 'pause' : 'play'} />
          </button>
          <button
            class="icon"
            disabled={current === undefined}
            onClick={() => post({t: 'next'})}
            title={s('player.next')}
            aria-label={s('player.next')}
          >
            <Icon name="next" />
          </button>
          <label class="volume" title={s('player.volume')}>
            <Icon name="volume" />
            <input
              type="range"
              min={0}
              max={100}
              value={room.volume}
              aria-label={s('player.volume')}
              onInput={event => post({t: 'volume', value: Number(event.currentTarget.value)})}
            />
          </label>
          <button
            class={playerVisible ? 'icon on' : 'icon'}
            onClick={() => post({t: 'togglePlayer'})}
            title={playerVisible ? s('player.hide') : s('player.show')}
            aria-label={playerVisible ? s('player.hide') : s('player.show')}
            aria-pressed={playerVisible}
          >
            <Icon name="window" />
          </button>
        </div>
      </section>

      <AddLink />
      <Queue tracks={room.tracks} />
    </main>
  )
}

function Scrubber({position, duration}: {position: number; duration: number}) {
  // Mientras se arrastra manda el dedo, no el estado que sigue llegando del host.
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const value = dragging ?? Math.min(position, duration)
  return (
    <div class="scrub">
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        step={1}
        value={value}
        disabled={duration <= 0}
        aria-label={s('player.seek')}
        onInput={event => setDragging(Number(event.currentTarget.value))}
        onChange={event => {
          post({t: 'seek', positionS: Number(event.currentTarget.value)})
          setDragging(undefined)
        }}
      />
      <span>{clock(value)}</span>
      <span>{duration > 0 ? clock(duration) : '–:––'}</span>
    </div>
  )
}

function AddLink() {
  const [url, setUrl] = useState('')
  return (
    <form
      class="add"
      onSubmit={event => {
        event.preventDefault()
        if (url.trim() === '') return
        post({t: 'add', url})
        setUrl('')
      }}
    >
      <input
        value={url}
        placeholder={s('add.placeholder')}
        aria-label={s('add.placeholder')}
        spellcheck={false}
        autocomplete="off"
        onInput={event => setUrl(event.currentTarget.value)}
      />
      <button type="submit" disabled={url.trim() === ''}>
        {s('add.button')}
      </button>
    </form>
  )
}

function Queue({tracks}: {tracks: TrackView[]}) {
  return (
    <section class="queue">
      <h3>
        {s('queue.title')} <span>{tracks.length}</span>
      </h3>
      {tracks.length === 0 ? (
        <p class="hint">{s('queue.empty')}</p>
      ) : (
        <ol>
          {tracks.map((track, index) => (
            <li key={track.id} class={track.current ? 'current' : undefined}>
              <span class="n">{index + 1}</span>
              <button class="pick" disabled={track.current} onClick={() => post({t: 'playNow', trackId: track.id})} title={s('queue.playNow')}>
                <span class="t">{track.title}</span>
                <span class="m">
                  {[track.author, s('queue.addedBy').replace('{0}', track.addedBy), track.unplayable ? s('queue.unplayable') : '']
                    .filter(part => part !== '')
                    .join(' · ')}
                </span>
              </button>
              <button class="icon" onClick={() => post({t: 'remove', trackId: track.id})} title={s('queue.remove')} aria-label={s('queue.remove')}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
