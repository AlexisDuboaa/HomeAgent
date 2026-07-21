// Registre en mémoire (pas besoin de survivre à un redémarrage) qui retient
// les cibles qu'automation-engine vient lui-même de modifier, pour ne pas
// confondre notre propre extinction avec une extinction manuelle de
// l'utilisateur.
import type { TargetKind } from './types.js'

const RECENT_WINDOW_MS = 10_000

const recentlyExecuted = new Map<string, number>()

function key(targetId: string, targetKind: TargetKind): string {
  return `${targetKind}:${targetId}`
}

export function markExecuted(targetId: string, targetKind: TargetKind): void {
  recentlyExecuted.set(key(targetId, targetKind), Date.now())
}

export function wasRecentlyExecuted(targetId: string, targetKind: TargetKind): boolean {
  const at = recentlyExecuted.get(key(targetId, targetKind))
  if (at === undefined) return false
  return Date.now() - at < RECENT_WINDOW_MS
}
