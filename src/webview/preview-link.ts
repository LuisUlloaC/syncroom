import {serializeCandidate} from '../protocol/bridge'
import type {HostToWebview, WebviewToHost} from '../protocol/webview'

/**
 * Lado vista de la vista previa: recibe la oferta del motor (vía host), contesta y entrega el
 * stream de vídeo. Por postMessage solo viajan datos planos: un RTCSessionDescription o un
 * RTCIceCandidate tal cual dan DataCloneError, y dentro de un handler async ni se ve.
 */
export class PreviewLink {
  onStream: ((stream: MediaStream | null) => void) | undefined

  private pc: RTCPeerConnection | undefined

  constructor(
    private readonly post: (message: WebviewToHost) => void,
    private readonly create: () => RTCPeerConnection = () => new RTCPeerConnection()
  ) {}

  async handle(msg: HostToWebview): Promise<void> {
    if (msg.t === 'previewEnd') {
      this.close()
      return
    }
    if (msg.t !== 'rtc') return
    const signal = msg.signal
    if (signal.kind === 'offer') {
      await this.answer(signal.sdp)
      return
    }
    if (signal.kind !== 'ice') return
    // Un candidato sin oferta delante (p. ej. de una conexión ya cerrada) no tiene dónde ir.
    const pc = this.pc
    if (pc === undefined) return
    try {
      await pc.addIceCandidate(signal.candidate)
    } catch (error) {
      console.warn('syncroom preview: candidate rejected', error)
    }
  }

  /** Cierra la conexión y vuelve a la miniatura. */
  close(): void {
    if (this.pc === undefined) return
    this.pc.close()
    this.pc = undefined
    this.onStream?.(null)
  }

  private async answer(sdp: string): Promise<void> {
    this.close()
    const pc = this.create()
    this.pc = pc
    pc.ontrack = event => {
      const stream = event.streams[0]
      if (this.pc === pc && stream !== undefined) this.onStream?.(stream)
    }
    pc.onicecandidate = event => {
      if (this.pc === pc && event.candidate !== null) {
        this.post({t: 'rtc', signal: {kind: 'ice', candidate: serializeCandidate(event.candidate)}})
      }
    }
    try {
      await pc.setRemoteDescription({type: 'offer', sdp})
      await pc.setLocalDescription(await pc.createAnswer())
      const answer = pc.localDescription?.sdp
      if (this.pc !== pc || answer === undefined) return
      this.post({t: 'rtc', signal: {kind: 'answer', sdp: answer}})
    } catch (error) {
      if (this.pc !== pc) return
      console.warn('syncroom preview: could not answer', error)
      this.close()
    }
  }
}
