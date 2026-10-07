export interface DropTarget {
  id: string
  side: 'before' | 'after'
}

export interface Placement {
  beforeId: string | null
  afterId: string | null
}

/**
 * Vecinos entre los que queda `draggingId` al soltarlo sobre `target`, o undefined si no se movería
 * (sobre sí misma, sobre su vecina por el lado que ya ocupa, o ids desconocidos).
 */
export function dropPlacement(ids: readonly string[], draggingId: string, target: DropTarget): Placement | undefined {
  const from = ids.indexOf(draggingId)
  if (from < 0 || target.id === draggingId) return undefined
  const others = ids.filter(id => id !== draggingId)
  const at = others.indexOf(target.id)
  if (at < 0) return undefined
  const to = target.side === 'before' ? at : at + 1
  if (to === from) return undefined
  return {beforeId: others[to - 1] ?? null, afterId: others[to] ?? null}
}
