import type {PlayerCommand, PlayerState, PlayerStatus} from '../core/sync'

const STATES: Record<number, PlayerState> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued'
}

const STATUS_INTERVAL_MS = 1000

function loadApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const host = window as Window & {onYouTubeIframeAPIReady?: () => void}
    host.onYouTubeIframeAPIReady = () => resolve()
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.onerror = () => reject(new Error('YouTube IFrame API unreachable'))
    document.head.appendChild(tag)
  })
}

/** Envoltorio del IFrame Player API oficial de YouTube. */
export class Player {
  onStatus: ((status: PlayerStatus) => void) | undefined
  onEnded: ((videoId: string) => void) | undefined
  onError: ((videoId: string | null, code: number) => void) | undefined

  /** Vídeo que nosotros mandamos cargar; null tras `stop`. */
  private videoId: string | null = null

  private constructor(private readonly yt: YT.Player) {}

  static async create(elementId: string): Promise<Player> {
    await loadApi()
    let player: Player | undefined
    const yt = await new Promise<YT.Player>(resolve => {
      const instance = new YT.Player(elementId, {
        width: '100%',
        height: '100%',
        playerVars: {playsinline: 1, rel: 0},
        events: {
          onReady: () => resolve(instance),
          onStateChange: event => player?.handleState(event.data),
          onError: event => player?.onError?.(player.videoId, event.data)
        }
      })
    })
    player = new Player(yt)
    const created = player
    setInterval(() => created.emitStatus(), STATUS_INTERVAL_MS)
    return created
  }

  apply(cmd: PlayerCommand): void {
    switch (cmd.type) {
      case 'load':
        this.videoId = cmd.videoId
        if (cmd.playing) this.yt.loadVideoById({videoId: cmd.videoId, startSeconds: cmd.startS})
        else this.yt.cueVideoById({videoId: cmd.videoId, startSeconds: cmd.startS})
        break
      case 'play':
        this.yt.playVideo()
        break
      case 'pause':
        this.yt.pauseVideo()
        break
      case 'seek':
        this.yt.seekTo(cmd.timeS, true)
        break
      case 'stop':
        this.videoId = null
        this.yt.stopVideo()
        break
    }
    this.emitStatus()
  }

  setVolume(value: number): void {
    this.yt.unMute()
    this.yt.setVolume(Math.min(100, Math.max(0, Math.round(value))))
  }

  status(): PlayerStatus {
    if (this.videoId === null) return {videoId: null, state: 'unstarted', timeS: 0, durationS: 0}
    return {
      videoId: this.videoId,
      state: STATES[this.yt.getPlayerState()] ?? 'unstarted',
      timeS: this.yt.getCurrentTime() || 0,
      durationS: this.yt.getDuration() || 0
    }
  }

  private emitStatus(): void {
    this.onStatus?.(this.status())
  }

  private handleState(state: number): void {
    this.emitStatus()
    if (state === 0 && this.videoId !== null) this.onEnded?.(this.videoId)
  }
}
