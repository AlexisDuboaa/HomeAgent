// Registre en mémoire (pas besoin de survivre à un redémarrage) qui retient
// les cibles qu'automation-engine vient lui-même de modifier, pour ne pas
// confondre notre propre extinction avec une extinction manuelle de
// l'utilisateur.
const RECENT_WINDOW_MS = 10_000

const recentlyExecuted = new Map<string, number>()

export function markExecuted(targetId: string): void {
  recentlyExecuted.set(targetId, Date.now())
}

export function wasRecentlyExecuted(targetId: string): boolean {
  const at = recentlyExecuted.get(targetId)
  if (at === undefined) return false
  return Date.now() - at < RECENT_WINDOW_MS
}
