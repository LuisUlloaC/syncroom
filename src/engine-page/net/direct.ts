import {joinRoom} from 'trystero'
import type {RoomKeys} from './crypto'
import type {Path} from './transport'

const APP_ID = 'syncroom-vscode'

export interface DirectPathOptions {
  code: string
  keys: RoomKeys
  /** Cuántos participantes hay conectados por WebRTC. */
  onPeers: (count: number) => void
}

/** WebRTC entre participantes. Trystero usa relays de Nostr solo para presentarlos. */
export function createDirectPath(options: DirectPathOptions): Path {
  const room = joinRoom({appId: APP_ID, password: options.code}, options.keys.roomId)
  const action = room.makeAction<string>('m')
  let peers = 0

  const path: Path = {
    onReceive: undefined,
    send(envelope) {
      if (peers > 0) void action.send(envelope)
    },
    close() {
      void room.leave()
    }
  }

  room.onPeerJoin = () => {
    peers += 1
    options.onPeers(peers)
  }
  room.onPeerLeave = () => {
    peers = Math.max(0, peers - 1)
    options.onPeers(peers)
  }
  action.onMessage = data => {
    if (typeof data === 'string') path.onReceive?.(data)
  }

  return path
}
