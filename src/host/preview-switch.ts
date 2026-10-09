/** Lo que decide si la vista previa debe estar en marcha. */
export interface PreviewInputs {
  inRoom: boolean
  /** La vista lateral principal está a la vista (y su webview ya cargó). */
  visible: boolean
  /** Ajuste `syncroom.videoPreview` del usuario. */
  enabled: boolean
  engineReady: boolean
}

/**
 * Decide qué mandar al motor; devuelve undefined si no cambia respecto a lo último enviado.
 * Al reiniciar el motor (`reset()`) vuelve a mandar: la página nueva no sabe nada.
 */
export class PreviewSwitch {
  private last: 'on' | 'off' | undefined

  update(inputs: PreviewInputs): 'on' | 'off' | undefined {
    const wanted = inputs.inRoom && inputs.visible && inputs.enabled && inputs.engineReady ? 'on' : 'off'
    if (wanted === this.last) return undefined
    this.last = wanted
    return wanted
  }

  reset(): void {
    this.last = undefined
  }
}
