import {serializeCandidate, type EngineToHost, type RtcSignal} from '../protocol/bridge'

/** `preferCurrentTab` (Chromium) aún no está en los tipos del DOM. */
const CAPTURE: DisplayMediaStreamOptions & {preferCurrentTab: boolean} = {
  // 30 como tope: la captura de pestaña solo saca un fotograma cuando la imagen cambia, así que
  // nunca pasa de los fps del vídeo (25 en el de prueba). Medido el 2026-10-09: ~1,5 Mbit/s en
  // loopback y ~0,27 núcleos entre Edge y VS Code (a 15 fps eran ~0,16).
  video: {frameRate: 30, width: 480},
  audio: false,
  preferCurrentTab: true
}

/**
 * Vista previa: captura esta misma pestaña (solo vídeo) y la manda por WebRTC a la vista lateral
 * de VS Code, en este equipo. El navegador la elige sin preguntar gracias a
 * `--auto-select-tab-capture-source-by-title` (ver engine-process.ts).
 */
export class Preview {
  private pc: RTCPeerConnection | undefined
  private track: MediaStreamTrack | undefined
  /** Cada start() deja obsoleto al anterior aunque aún esté esperando a la captura. */
  private generation = 0

  constructor(private readonly send: (msg: EngineToHost) => void) {}

  /** Captura la pestaña y manda la oferta. Si ya había una, la cierra y empieza de nuevo. */
  async start(): Promise<void> {
    this.stop()
    const generation = ++this.generation
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(CAPTURE)
    } catch (error) {
      if (generation !== this.generation) return
      this.send({t: 'log', text: `preview capture failed: ${String(error)}`})
      this.send({t: 'preview', state: 'unavailable'})
      return
    }
    const track = stream.getVideoTracks()[0]
    if (generation !== this.generation || track === undefined) {
      for (const each of stream.getTracks()) each.stop()
      return
    }
    this.track = track
    // Es vídeo, no una pantalla con texto: que el codificador priorice fluidez sobre nitidez.
    track.contentHint = 'motion'
    const {width, height} = track.getSettings()
    this.send({t: 'log', text: `preview capture ${width ?? '?'}x${height ?? '?'} of a ${innerWidth}x${innerHeight} page`})
    this.send({t: 'preview', state: 'on', width, height})
    track.onended = () => {
      if (this.track === track) this.stop()
    }

    const pc = new RTCPeerConnection()
    this.pc = pc
    pc.addTrack(track, stream)
    pc.onicecandidate = event => {
      if (event.candidate !== null && this.pc === pc) {
        this.send({t: 'rtc', signal: {kind: 'ice', candidate: serializeCandidate(event.candidate)}})
      }
    }
    try {
      await pc.setLocalDescription(await pc.createOffer())
      const sdp = pc.localDescription?.sdp
      if (this.pc !== pc || sdp === undefined) return
      this.send({t: 'rtc', signal: {kind: 'offer', sdp}})
    } catch (error) {
      if (this.pc !== pc) return
      this.send({t: 'log', text: `preview offer failed: ${String(error)}`})
      this.stop()
    }
  }

  /** Respuesta y candidatos de la vista lateral. Los fallos solo van al registro. */
  async signal(signal: RtcSignal): Promise<void> {
    const pc = this.pc
    if (pc === undefined) return
    try {
      if (signal.kind === 'answer') await pc.setRemoteDescription({type: 'answer', sdp: signal.sdp})
      else if (signal.kind === 'ice') await pc.addIceCandidate(signal.candidate)
    } catch (error) {
      this.send({t: 'log', text: `preview ${signal.kind} failed: ${String(error)}`})
    }
  }

  /** Cierra la conexión y la captura; avisa al host si estaba en marcha. */
  stop(): void {
    this.generation += 1
    const wasOn = this.track !== undefined
    this.pc?.close()
    this.pc = undefined
    this.track?.stop()
    this.track = undefined
    if (wasOn) this.send({t: 'preview', state: 'off'})
  }
}
