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
      await executeActions(client, actions)
      await store.appendHistory(automation.id, {
        at: new Date().toISOString(),
        success: true,
        actionsExecuted: actions.length,
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
