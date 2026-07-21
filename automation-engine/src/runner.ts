import { evaluate } from './evaluator.js'
import { executeActions } from './executor.js'
import type { HueClient } from './hueClient.js'
import { buildSnapshot } from './snapshot.js'
import type { AutomationStore } from './store.js'
import type { BridgeStateSnapshot, EvaluationContext } from './types.js'

export async function runTick(
  store: AutomationStore,
  client: HueClient,
  ctx: EvaluationContext,
  snapshot?: BridgeStateSnapshot
): Promise<void> {
  let currentSnapshot: BridgeStateSnapshot
  try {
    currentSnapshot = snapshot ?? (await buildSnapshot(client))
  } catch (err) {
    console.error('Bridge Hue injoignable, tick ignoré :', err instanceof Error ? err.message : err)
    return
  }

  for (const automation of store.list()) {
    const actions = evaluate(automation, ctx, currentSnapshot)
    if (!actions) continue

    try {
      const { executed, skipped } = await executeActions(client, actions, {
        store,
        automationId: automation.id,
        respectManualOff: automation.respectManualOff ?? false,
        now: ctx.now,
      })
      await store.appendHistory(automation.id, {
        at: new Date().toISOString(),
        success: true,
        actionsExecuted: executed,
        skippedActions: skipped > 0 ? skipped : undefined,
      })
    } catch (err) {
      await store.appendHistory(automation.id, {
        at: new Date().toISOString(),
        success: false,
        error: err instanceof Error ? err.message : 'Erreur inconnue',
        actionsExecuted: 0,
      })
    }
  }
}
