/** Volumen del aviso: no depende del de la música (con la música a cero el chat se sigue oyendo). */
const GAIN = 0.18
/** Dos notas cortas que suben (la5 → mi6): se distingue de la música sin asustar. */
const NOTES = [
  {hz: 880, at: 0, length: 0.12},
  {hz: 1318.5, at: 0.09, length: 0.2}
]

let context: AudioContext | undefined

/** Aviso de mensaje nuevo. El navegador del motor arranca con autoplay sin gesto: suena sin clic. */
export function chime(): void {
  context ??= new AudioContext()
  const start = context.currentTime + 0.01
  for (const note of NOTES) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'sine'
    osc.frequency.value = note.hz
    // Entrada y salida suaves: un corte en seco suena a clic.
    gain.gain.setValueAtTime(0, start + note.at)
    gain.gain.linearRampToValueAtTime(GAIN, start + note.at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length)
    osc.connect(gain).connect(context.destination)
    osc.start(start + note.at)
    osc.stop(start + note.at + note.length + 0.02)
  }
}
