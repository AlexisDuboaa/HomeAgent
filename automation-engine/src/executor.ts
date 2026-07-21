import { markExecuted } from './selfAttribution.js'
import type { HueClient } from './hueClient.js'
import type { AutomationStore } from './store.js'
import { isSuppressed } from './suppression.js'
import type { Action } from './types.js'

export interface ExecutionContext {
  store: AutomationStore
  automationId: string
  respectManualOff: boolean
  now: Date
}

export async function executeActions(
  client: HueClient,
  actions: Action[],
  ctx: ExecutionContext
): Promise<{ executed: number; skipped: number }> {
  let executed = 0
  let skipped = 0

  for (const action of actions) {
    const target = actionTarget(action)

    if (ctx.respectManualOff && target && isRelightAction(action)) {
      const suppressions = ctx.store.getSuppressions()
      if (isSuppressed(suppressions, ctx.automationId, target, ctx.now)) {
        skipped++
        continue
      }
    }

    if (action.type === 'set_light_state') {
      if (action.targetKind === 'light') {
        await client.setLightState(action.targetId, action.update as Record<string, unknown>)
      } else {
        await client.setGroupState(action.targetId, action.update as Record<string, unknown>)
      }
    } else {
      await client.activateScene(action.groupId, action.sceneId)
    }

    if (target) markExecuted(target)
    executed++
  }

  return { executed, skipped }
}

function actionTarget(action: Action): string | null {
  if (action.type === 'set_light_state') return action.targetId
  if (action.type === 'activate_scene') return action.groupId
  return null
}

function isRelightAction(action: Action): boolean {
  return (action.type === 'set_light_state' && action.update.on === true) || action.type === 'activate_scene'
}
