import {useEffect, useRef, useState} from 'preact/hooks'
import {formatRoomCode} from '../core/ids'
import type {ChatLine, RoomView, TrackView} from '../host/session'
import type {HostToWebview, ViewState, WebviewToHost} from '../protocol/webview'
import {clock, thumbnail} from './format'
import {dropPlacement, type DropTarget} from './queue-drop'
import {Icon} from './icons'

declare function acquireVsCodeApi(): {postMessage(message: WebviewToHost): void}

const vscode = acquireVsCodeApi()
const injected = window as Window & {__SYNCROOM_STRINGS__?: Record<string, string>; __SYNCROOM_VIEW__?: string}
const strings = injected.__SYNCROOM_STRINGS__ ?? {}
/** `chat`: esta instancia es la vista del segundo icono; solo pinta el chat. */
const viewMode: 'room' | 'chat' = injected.__SYNCROOM_VIEW__ === 'chat' ? 'chat' : 'room'
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

  if (viewMode === 'chat') {
    return (
      <main class="chatview">
        {state.inRoom ? <Chat lines={state.room.chat} /> : <p class="hint">{s('chat.join')}</p>}
      </main>
    )
  }
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
          <MyName name={room.me.name} />
          {others.map(peer => `, ${peer.name === '' ? s('room.unnamed') : peer.name}`)}
        </span>
        <span class={room.net.directPeers > 0 ? 'link direct' : 'link'}>
          {!room.engineReady ? s('room.starting') : room.fault !== undefined ? s('room.fault') : link}
        </span>
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

/** El nombre propio: clic para editarlo en el sitio; Enter o salir guarda, Escape cancela. */
function MyName({name}: {name: string}) {
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const editing = draft !== undefined
  if (!editing) {
    return (
      <button class="me" onClick={() => setDraft(name)} title={s('room.rename')}>
        {name} ({s('room.you')})
      </button>
    )
  }
  return <NameEditor initial={draft} current={name} onDone={() => setDraft(undefined)} />
}

/** El cuadro de edición: Enter o salir guarda, Escape cancela. Se enfoca una sola vez, al aparecer. */
function NameEditor({initial, current, onDone}: {initial: string; current: string; onDone: () => void}) {
  const [draft, setDraft] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  // Al quitar el input del DOM Chromium puede disparar blur: esta bandera evita guardar dos veces o tras Escape.
  const settled = useRef(false)
  useEffect(() => input.current?.focus(), [])
  const finish = (save: boolean): void => {
    if (settled.current) return
    settled.current = true
    const clean = draft.trim()
    if (save && clean !== '' && clean !== current) post({t: 'rename', name: clean})
    onDone()
  }
  return (
    <input
      ref={input}
      class="me"
      value={draft}
      maxLength={40}
      aria-label={s('room.rename')}
      spellcheck={false}
      autocomplete="off"
      onInput={event => setDraft(event.currentTarget.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
    />
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
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const [target, setTarget] = useState<DropTarget | undefined>(undefined)
  const currentIndex = tracks.findIndex(track => track.current)
  const nextId = tracks[currentIndex + 1]?.id

  const finish = (): void => {
    setDragging(undefined)
    setTarget(undefined)
  }

  const drop = (): void => {
    const placement = dragging === undefined || target === undefined ? undefined : dropPlacement(tracks.map(t => t.id), dragging, target)
    if (dragging !== undefined && placement !== undefined) post({t: 'move', trackId: dragging, ...placement})
    finish()
  }

  return (
    <section class="queue">
      <h3>
        {s('queue.title')} <span>{tracks.length}</span>
      </h3>
      {tracks.length === 0 ? (
        <p class="hint">{s('queue.empty')}</p>
      ) : (
        <ol>
          {tracks.map((track, index) => {
            const classes = [
              track.current ? 'current' : '',
              dragging === track.id ? 'dragging' : '',
              target?.id === track.id && dragging !== track.id ? `drop-${target.side}` : ''
            ]
              .filter(part => part !== '')
              .join(' ')
            return (
              <li
                key={track.id}
                class={classes === '' ? undefined : classes}
                draggable
                onDragStart={event => {
                  setDragging(track.id)
                  if (event.dataTransfer !== null) {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', track.id)
                  }
                }}
                onDragOver={event => {
                  if (dragging === undefined) return
                  event.preventDefault()
                  const box = event.currentTarget.getBoundingClientRect()
                  const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
                  if (target?.id !== track.id || target.side !== side) setTarget({id: track.id, side})
                }}
                onDrop={event => {
                  event.preventDefault()
                  drop()
                }}
                onDragEnd={finish}
              >
                <span class="n" title={s('queue.drag')}>
                  <span class="num">{index + 1}</span>
                  <Icon name="grip" />
                </span>
                <button class="pick" disabled={track.current} onClick={() => post({t: 'playNow', trackId: track.id})} title={s('queue.playNow')}>
                  <span class="t">{track.title}</span>
                  <span class="m">
                    {[track.author, s('queue.addedBy').replace('{0}', track.addedBy), track.unplayable ? s('queue.unplayable') : '']
                      .filter(part => part !== '')
                      .join(' · ')}
                  </span>
                </button>
                <span class="tools">
                  {!track.current && track.id !== nextId && (
                    <button class="icon" onClick={() => post({t: 'playNext', trackId: track.id})} title={s('queue.playNext')} aria-label={s('queue.playNext')}>
                      <Icon name="up" />
                    </button>
                  )}
                  <button class="icon" onClick={() => post({t: 'remove', trackId: track.id})} title={s('queue.remove')} aria-label={s('queue.remove')}>
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// La hora de cada línea se formatea una sola vez: la vista se repinta cada segundo con el chat entero.
const times = new Map<number, string>()
function time(key: number, at: number): string {
  let text = times.get(key)
  if (text === undefined) {
    text = new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
    if (times.size > 400) times.clear()
    times.set(key, text)
  }
  return text
}

/** La vista de chat: ocupa todo el alto; los no leídos los cuenta el host y los pone en el icono. */
function Chat({lines}: {lines: ChatLine[]}) {
  const [text, setText] = useState('')
  const lastKey = lines.at(-1)?.key
  const list = useRef<HTMLOListElement>(null)
  // Si el usuario está al fondo, cada línea nueva baja la lista; si subió a leer, se respeta.
  const stuck = useRef(true)

  useEffect(() => {
    const el = list.current
    if (el !== null && stuck.current) el.scrollTop = el.scrollHeight
  }, [lastKey])

  const send = (): void => {
    const clean = text.trim()
    if (clean === '') return
    post({t: 'say', text: clean})
    setText('')
    stuck.current = true
  }

  return (
    <section class="chat">
      {lines.length === 0 ? (
        <p class="hint">{s('chat.empty')}</p>
      ) : (
        <ol
          ref={list}
          onScroll={event => {
            const el = event.currentTarget
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
          }}
        >
          {lines.map(line =>
            line.kind === 'message' ? (
              <li key={line.key} class={line.mine ? 'line mine' : 'line'}>
                <span class="who">{line.name === '' ? s('room.unnamed') : line.name}</span>
                <span class="when">{time(line.key, line.at)}</span>
                <span class="text">{line.text}</span>
              </li>
            ) : (
              <li key={line.key} class="system">
                {line.kind === 'present'
                  ? s('chat.present').replace('{0}', line.text)
                  : (line.kind === 'joined' ? s('chat.joined') : s('chat.left')).replace('{0}', line.name)}
              </li>
            )
          )}
        </ol>
      )}
      <form
        class="say"
        onSubmit={event => {
          event.preventDefault()
          send()
        }}
      >
        <input
          value={text}
          maxLength={500}
          placeholder={s('chat.placeholder')}
          aria-label={s('chat.placeholder')}
          autocomplete="off"
          ref={el => {
            // Al abrir la vista, el cursor ya está en la caja.
            if (el !== null && document.activeElement === document.body) el.focus()
          }}
          onInput={event => setText(event.currentTarget.value)}
        />
        <button type="submit" class="icon" disabled={text.trim() === ''} title={s('chat.send')} aria-label={s('chat.send')}>
          <Icon name="send" />
        </button>
      </form>
    </section>
  )
}
