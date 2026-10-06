import type {EngineToHost, HostToEngine} from '../protocol/bridge'

/** Canal WebSocket con el extension host. */
export class HostLink {
  onMessage: ((msg: HostToEngine) => void) | undefined
  /** El host desapareció: hay que callarse y cerrar. */
  onLost: (() => void) | undefined

  private socket: WebSocket | undefined

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      socket.onopen = () => {
        this.socket = socket
        resolve()
      }
      socket.onerror = () => reject(new Error('bridge unreachable'))
      socket.onmessage = event => {
        let msg: HostToEngine
        try {
          msg = JSON.parse(String(event.data)) as HostToEngine
        } catch {
          return
        }
        this.onMessage?.(msg)
      }
      socket.onclose = () => {
        this.socket = undefined
        this.onLost?.()
      }
    })
  }

  send(msg: EngineToHost): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg))
  }
}
