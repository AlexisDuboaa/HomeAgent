import suncalc from 'suncalc'
import type { AutomationStore } from './store.js'
import type { Action, TargetKind } from './types.js'

export function suppressionKey(automationId: string, targetId: string): string {
  return `${automationId}:${targetId}`
}

export function isSuppressed(
  suppressions: Record<string, { until: string }>,
  automationId: string,
  targetId: string,
  now: Date
): boolean {
  const entry = suppressions[suppressionKey(automationId, targetId)]
  if (!entry) return false
  return now < new Date(entry.until)
}

export function nextSunrise(now: Date, latitude: number, longitude: number): Date {
  const today = suncalc.getTimes(now, latitude, longitude).sunrise
  if (today > now) return today
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return suncalc.getTimes(tomorrow, latitude, longitude).sunrise
}

export async function recordManualOff(
  store: AutomationStore,
  targetId: string,
  targetKind: TargetKind,
  now: Date
): Promise<void> {
  const config = store.getConfig()
  if (!config) return // pas de lat/long connue, on ne peut pas calculer le prochain lever de soleil

  const until = nextSunrise(now, config.latitude, config.longitude).toISOString()

  for (const automation of store.list()) {
    if (!automation.respectManualOff) continue
    const targets = automation.actions.some((action) => actionTargets(action, targetId, targetKind))
    if (!targets) continue
    await store.setSuppression(suppressionKey(automation.id, targetId), until)
  }
}

function actionTargets(action: Action, targetId: string, targetKind: TargetKind): boolean {
  if (action.type === 'set_light_state') {
    return action.targetId === targetId && action.targetKind === targetKind
  }
  if (action.type === 'activate_scene') {
    return action.groupId === targetId && targetKind === 'group'
  }
  return false
}
