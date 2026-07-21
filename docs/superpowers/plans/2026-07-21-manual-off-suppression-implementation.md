# Manual-Off Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an automation opt in ("respecter l'extinction manuelle") so it won't relight a light/group that the user turned off manually, until the next sunrise.

**Architecture:** Two new `automation-engine` modules — an in-memory self-attribution registry (disambiguates our own actions from genuine external state changes) and a persisted per-`(automation, target)` suppression store — wired into the existing eventstream listener (detection) and action executor (enforcement).

**Tech Stack:** Same as the rest of `automation-engine` — Node.js/TypeScript, `suncalc` (already a dependency), Vitest for the two new pure functions.

**Spec:** `docs/superpowers/specs/2026-07-21-manual-off-suppression-design.md`

## Global Constraints

- Granularity is per automation × per action target, not global per light/group (spec, Exigences validées).
- Self-attribution window is exactly 10 seconds (spec, Architecture).
- Suppression is lifted lazily at the next sunrise — no active cleanup task, just a `now < until` check at read time (spec, Flux d'exécution).
- Only `set_light_state` actions with `update.on === true` and all `activate_scene` actions are suppressible ("relight" actions); actions that turn something off are never suppressed (spec, Flux d'exécution — this constraint isn't spelled out as a separate bullet in the spec but follows directly from "ne doivent pas être rallumées automatiquement").
- Automated tests stay scoped to pure functions only: the existing rule evaluator, plus (new in this plan) `isSuppressed` and `nextSunrise`. Everything else is verified manually against the real bridge (spec, Tests).
- `AutomationRunLogEntry.skippedActions` is only set (non-`undefined`) when at least one action was actually skipped — `actionsExecuted` continues to count only actions that ran (spec, Historique).

---

## Task 1: Data model — `respectManualOff`, `skippedActions`, suppression storage

**Files:**
- Modify: `automation-engine/src/types.ts`
- Modify: `automation-engine/src/store.ts`

**Interfaces:**
- Produces: `Automation.respectManualOff?: boolean`, `AutomationRunLogEntry.skippedActions?: number`, `AutomationsStoreData.suppressions: Record<string, { until: string }>`. `AutomationStore` methods: `getSuppressions(): Record<string, { until: string }>`, `setSuppression(key: string, until: string): Promise<void>`. Tasks 2–4 consume these.

- [ ] **Step 1: Add the new fields to `automation-engine/src/types.ts`**

Change the `Automation` interface:

```ts
export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: string
  respectManualOff?: boolean
}
```

Change `AutomationRunLogEntry`:

```ts
export interface AutomationRunLogEntry {
  at: string
  success: boolean
  error?: string
  actionsExecuted: number
  skippedActions?: number
}
```

Change `AutomationsStoreData`:

```ts
export interface AutomationsStoreData {
  automations: Automation[]
  history: Record<string, AutomationRunLogEntry[]>
  config: LocationConfig | null
  suppressions: Record<string, { until: string }>
}
```

- [ ] **Step 2: Update the store**

In `automation-engine/src/store.ts`, update `DEFAULT_DATA` (currently `{ automations: [], history: {}, config: null }`) to include the new collection:

```ts
const DEFAULT_DATA: AutomationsStoreData = { automations: [], history: {}, config: null, suppressions: {} }
```

Add two methods to the `AutomationStore` class (after `setConfig`):

```ts
  getSuppressions(): Record<string, { until: string }> {
    return this.db.data.suppressions
  }

  async setSuppression(key: string, until: string): Promise<void> {
    this.db.data.suppressions[key] = { until }
    await this.db.write()
  }
```

Update `remove()` to also clean up any suppression entries for the deleted automation (they're keyed `"<automationId>:<targetId>"`, so filter by prefix). Current method:

```ts
  async remove(id: string): Promise<boolean> {
    const before = this.db.data.automations.length
    this.db.data.automations = this.db.data.automations.filter((a) => a.id !== id)
    delete this.db.data.history[id]
    await this.db.write()
    return this.db.data.automations.length < before
  }
```

Replace with:

```ts
  async remove(id: string): Promise<boolean> {
    const before = this.db.data.automations.length
    this.db.data.automations = this.db.data.automations.filter((a) => a.id !== id)
    delete this.db.data.history[id]
    for (const key of Object.keys(this.db.data.suppressions)) {
      if (key.startsWith(`${id}:`)) delete this.db.data.suppressions[key]
    }
    await this.db.write()
    return this.db.data.automations.length < before
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify persistence end-to-end (no bridge needed)**

```bash
cd automation-engine
npm run build
mkdir -p /tmp/store-check
DATA_FILE=/tmp/store-check/automations.json PORT=3098 node -e "
const { AutomationStore } = require('./dist/store.js');
(async () => {
  const store = new AutomationStore(process.env.DATA_FILE);
  await store.init();
  await store.setSuppression('a1:5', new Date(Date.now() + 60000).toISOString());
  console.log('suppressions:', JSON.stringify(store.getSuppressions()));
})();
"
cat /tmp/store-check/automations.json
rm -rf /tmp/store-check
```
Expected: the console log shows `{"a1:5":{"until":"..."}}`, and the JSON file on disk has a top-level `"suppressions"` key with the same entry.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/types.ts automation-engine/src/store.ts
git commit -m "Add respectManualOff, skippedActions, and suppression storage to the data model"
```

---

## Task 2: `suppression.ts` and `selfAttribution.ts` (TDD for the pure functions)

**Files:**
- Create: `automation-engine/test/suppression.test.ts`
- Create: `automation-engine/src/suppression.ts`
- Create: `automation-engine/src/selfAttribution.ts`

**Interfaces:**
- Consumes: `AutomationStore` (Task 1), `Action`, `TargetKind`, `LocationConfig` from `automation-engine/src/types.ts`.
- Produces: `suppressionKey(automationId: string, targetId: string): string`, `isSuppressed(suppressions: Record<string, { until: string }>, automationId: string, targetId: string, now: Date): boolean`, `nextSunrise(now: Date, latitude: number, longitude: number): Date`, `recordManualOff(store: AutomationStore, targetId: string, targetKind: TargetKind, now: Date): Promise<void>` — all from `suppression.ts`. `markExecuted(targetId: string): void`, `wasRecentlyExecuted(targetId: string): boolean` from `selfAttribution.ts`. Task 3 (executor) consumes `isSuppressed`, `markExecuted`. Task 4 (eventListener) consumes `recordManualOff`, `wasRecentlyExecuted`.

- [ ] **Step 1: Write the failing tests for the pure functions**

`automation-engine/test/suppression.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import suncalc from 'suncalc'
import { isSuppressed, nextSunrise, suppressionKey } from '../src/suppression.js'

const PARIS_LAT = 48.8566
const PARIS_LON = 2.3522

describe('suppressionKey', () => {
  it('joins automationId and targetId with a colon', () => {
    expect(suppressionKey('a1', '5')).toBe('a1:5')
  })
})

describe('isSuppressed', () => {
  it('returns false when there is no entry for the key', () => {
    expect(isSuppressed({}, 'a1', '5', new Date())).toBe(false)
  })

  it('returns true when the suppression is still in the future', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() + 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '5', new Date())).toBe(true)
  })

  it('returns false when the suppression has already expired', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() - 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '5', new Date())).toBe(false)
  })

  it('is scoped to the exact automationId/targetId pair', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() + 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '6', new Date())).toBe(false)
    expect(isSuppressed(suppressions, 'a2', '5', new Date())).toBe(false)
  })
})

describe('nextSunrise', () => {
  it('returns today\'s sunrise when now is before it', () => {
    const now = new Date(2026, 0, 1, 0, 0) // minuit, avant le lever du soleil
    const expected = suncalc.getTimes(now, PARIS_LAT, PARIS_LON).sunrise
    expect(nextSunrise(now, PARIS_LAT, PARIS_LON)).toEqual(expected)
  })

  it('returns tomorrow\'s sunrise when now is after today\'s', () => {
    const now = new Date(2026, 0, 1, 23, 0) // 23h, après le lever du soleil du jour
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const expected = suncalc.getTimes(tomorrow, PARIS_LAT, PARIS_LON).sunrise
    expect(nextSunrise(now, PARIS_LAT, PARIS_LON)).toEqual(expected)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd automation-engine && npm test`
Expected: FAIL — `Cannot find module '../src/suppression.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write `suppression.ts`**

`automation-engine/src/suppression.ts`:

```ts
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
```

- [ ] **Step 4: Write `selfAttribution.ts`**

No test file for this one — it's a stateful in-memory registry, not a pure function (per the plan's Global Constraints, only `isSuppressed`/`nextSunrise` get automated tests). Verified manually in Task 4's manual verification step instead.

`automation-engine/src/selfAttribution.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd automation-engine && npm test`
Expected: PASS — all tests in both `evaluator.test.ts` and `suppression.test.ts` green (18 + 7 = 25 tests).

- [ ] **Step 6: Verify the whole project still compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add automation-engine/src/suppression.ts automation-engine/src/selfAttribution.ts automation-engine/test/suppression.test.ts
git commit -m "Add suppression tracking and self-attribution registry"
```

---

## Task 3: Executor and runner integration

**Files:**
- Modify: `automation-engine/src/executor.ts` (full replacement)
- Modify: `automation-engine/src/runner.ts` (full replacement)

**Interfaces:**
- Consumes: `isSuppressed`, `markExecuted` (Task 2); `AutomationStore` (Task 1).
- Produces: `executeActions(client: HueClient, actions: Action[], ctx: ExecutionContext): Promise<{ executed: number; skipped: number }>` where `ExecutionContext = { store: AutomationStore; automationId: string; respectManualOff: boolean; now: Date }`. `runTick` keeps its existing signature (`store, client, ctx: EvaluationContext, snapshot?`) — no external caller (scheduler.ts, eventListener.ts) needs to change for this task.

- [ ] **Step 1: Rewrite the executor**

Replace `automation-engine/src/executor.ts` entirely. The current file only executes actions unconditionally; this version adds a suppression check before any action that would turn something on, and self-attributes every action it actually executes:

```ts
import { markExecuted } from './selfAttribution.js'
import type { AutomationStore } from './store.js'
import { isSuppressed } from './suppression.js'
import type { Action, HueClient } from './types.js'

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
```

Note: `HueClient` was previously imported with `import type { HueClient } from './hueClient.js'` — this rewrite imports it from `./types.js` instead, which is wrong. Correct it: keep the original import line `import type { HueClient } from './hueClient.js'` (the actual class lives in `hueClient.ts`, not `types.ts`). The corrected import block at the top of the file is:

```ts
import { markExecuted } from './selfAttribution.js'
import type { HueClient } from './hueClient.js'
import type { AutomationStore } from './store.js'
import { isSuppressed } from './suppression.js'
import type { Action } from './types.js'
```

- [ ] **Step 2: Update the runner to pass the execution context and log skipped actions**

Replace `automation-engine/src/runner.ts` entirely:

```ts
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
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify existing tests still pass**

Run: `cd automation-engine && npm test`
Expected: PASS — 25/25 tests (unaffected by this task; `executor.ts`/`runner.ts` have no automated tests per the project's convention, but this confirms the refactor didn't break `evaluator.ts`/`suppression.ts`'s compilation path).

- [ ] **Step 5: Verify suppression is enforced, without a bridge**

```bash
cd automation-engine
npm run build
cat > /tmp/verify-executor.mjs <<'EOF'
import { AutomationStore } from './dist/store.js'
import { executeActions } from './dist/executor.js'

const store = new AutomationStore('/tmp/verify-executor.json')
await store.init()
const automation = await store.create({
  name: 'Test',
  enabled: true,
  respectManualOff: true,
  trigger: { type: 'time', hour: 7, minute: 0, days: [] },
  conditions: [],
  actions: [{ type: 'set_light_state', targetId: '5', targetKind: 'light', update: { on: true } }],
})
await store.setSuppression(`${automation.id}:5`, new Date(Date.now() + 60_000).toISOString())

// Le client Hue n'est jamais appelé si l'action est suspendue — un client qui jette
// une erreur au moindre appel prouve que executeActions a bien sauté l'action.
const client = {
  setLightState: () => { throw new Error('should not be called — action was suppressed') },
  setGroupState: () => { throw new Error('should not be called') },
  activateScene: () => { throw new Error('should not be called') },
}

const result = await executeActions(client, automation.actions, {
  store,
  automationId: automation.id,
  respectManualOff: true,
  now: new Date(),
})
console.log('result:', JSON.stringify(result))
if (result.executed !== 0 || result.skipped !== 1) {
  throw new Error('expected 0 executed, 1 skipped')
}
console.log('OK: suppressed action was correctly skipped')
EOF
node /tmp/verify-executor.mjs
rm -f /tmp/verify-executor.mjs /tmp/verify-executor.json
```
Expected: `result: {"executed":0,"skipped":1}` followed by `OK: suppressed action was correctly skipped` — no thrown error (which would mean the suppression check failed to prevent the Hue API call).

- [ ] **Step 6: Commit**

```bash
git add automation-engine/src/executor.ts automation-engine/src/runner.ts
git commit -m "Enforce manual-off suppression in the action executor"
```

---

## Task 4: Eventstream listener integration

**Files:**
- Modify: `automation-engine/src/eventListener.ts`

**Interfaces:**
- Consumes: `wasRecentlyExecuted` (Task 2, `selfAttribution.ts`), `recordManualOff` (Task 2, `suppression.ts`).
- Produces: nothing consumed by later tasks — this is the last backend task.

- [ ] **Step 1: Detect and record manual-off events**

In `automation-engine/src/eventListener.ts`, add two imports at the top (alongside the existing ones):

```ts
import { wasRecentlyExecuted } from './selfAttribution.js'
import { recordManualOff } from './suppression.js'
```

Then find the `light`/`grouped_light` branch inside `handleEvent`:

```ts
    } else if (event.type === 'light' || event.type === 'grouped_light') {
      const targetKind: TargetKind = event.type === 'grouped_light' ? 'group' : 'light'
      let snapshot
      try {
        snapshot = await buildSnapshot(client)
      } catch (err) {
        console.error('Bridge Hue injoignable, événement ignoré :', err instanceof Error ? err.message : err)
        return
      }
      const on = (targetKind === 'light' ? snapshot.lights : snapshot.groups)[targetId]?.on
      if (on === undefined) return
      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'light_state', targetId, targetKind, state: on ? 'on' : 'off' } },
        snapshot
      )
    }
```

Insert a manual-off check right after the `if (on === undefined) return` line, before the `runTick` call:

```ts
    } else if (event.type === 'light' || event.type === 'grouped_light') {
      const targetKind: TargetKind = event.type === 'grouped_light' ? 'group' : 'light'
      let snapshot
      try {
        snapshot = await buildSnapshot(client)
      } catch (err) {
        console.error('Bridge Hue injoignable, événement ignoré :', err instanceof Error ? err.message : err)
        return
      }
      const on = (targetKind === 'light' ? snapshot.lights : snapshot.groups)[targetId]?.on
      if (on === undefined) return

      if (!on && !wasRecentlyExecuted(targetId)) {
        await recordManualOff(store, targetId, targetKind, now)
      }

      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'light_state', targetId, targetKind, state: on ? 'on' : 'off' } },
        snapshot
      )
    }
```

(`now` is already in scope at this point in `handleEvent` — it's defined earlier in the function, right before `ctxBase`.)

- [ ] **Step 2: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd automation-engine && npm test`
Expected: PASS — 25/25 tests (this task doesn't touch tested modules, confirms no regression).

- [ ] **Step 4: [MANUAL — needs real bridge] Verify end-to-end against the physical bridge**

This step needs a real Hue bridge with at least one light and one automation with `respectManualOff: true` targeting it — run it yourself, the implementer has no bridge access:

1. Create an automation (via the frontend, once Task 6 ships — or directly via `POST /automations` with `"respectManualOff": true`) whose action turns on a specific light, and whose trigger is something you can fire on demand (e.g. a `sensor` trigger on a motion sensor you can wave a hand in front of, or a `light_state` trigger — anything repeatable).
2. Turn the light on manually (Hue app or physical switch), then turn it off manually.
3. Immediately re-trigger the automation's condition (e.g. wave at the motion sensor again).
4. Expected: `docker logs automation-engine-container` (or local `npm run dev` output) shows the automation's history logging a run with `skippedActions: 1` and `actionsExecuted: 0` for that light — the light stays off.
5. Wait until after the next sunrise (or temporarily edit the stored suppression's `until` in the JSON data file to a past timestamp, restart the service, and re-trigger) and confirm the automation relights the target normally again.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/eventListener.ts
git commit -m "Detect manual light-off events and record suppression for opted-in automations"
```

---

## Task 5: Frontend types

**Files:**
- Modify: `src/types/automation.ts`

**Interfaces:**
- Produces: `Automation.respectManualOff?: boolean`, `AutomationRunLogEntry.skippedActions?: number` — mirrors Task 1's backend types, per this project's established front/backend duplication convention (no shared package).

- [ ] **Step 1: Mirror the two new fields**

In `src/types/automation.ts`, the current `Automation` interface is:

```ts
export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: string
}
```

Change to:

```ts
export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: string
  respectManualOff?: boolean
}
```

The current `AutomationRunLogEntry` is:

```ts
export interface AutomationRunLogEntry {
  at: string
  success: boolean
  error?: string
  actionsExecuted: number
}
```

Change to:

```ts
export interface AutomationRunLogEntry {
  at: string
  success: boolean
  error?: string
  actionsExecuted: number
  skippedActions?: number
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` from the repo root.
Expected: succeeds (the new optional fields aren't consumed anywhere yet — Task 6 does that — so this compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add src/types/automation.ts
git commit -m "Mirror respectManualOff and skippedActions in frontend types"
```

---

## Task 6: Frontend UI — checkbox and history display

**Files:**
- Modify: `src/pages/AutomationForm.tsx`

**Interfaces:**
- Consumes: `Automation.respectManualOff`, `AutomationRunLogEntry.skippedActions` (Task 5).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add state, load it when editing, and include it in the save payload**

The current state declarations (near the top of the component) are:

```ts
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [trigger, setTrigger] = useState<Trigger>(defaultTrigger())
  const [conditions, setConditions] = useState<Condition[]>([])
  const [actions, setActions] = useState<Action[]>([defaultAction()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AutomationRunLogEntry[]>([])
```

Add a new state variable after `enabled`:

```ts
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [respectManualOff, setRespectManualOff] = useState(false)
  const [trigger, setTrigger] = useState<Trigger>(defaultTrigger())
  const [conditions, setConditions] = useState<Condition[]>([])
  const [actions, setActions] = useState<Action[]>([defaultAction()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AutomationRunLogEntry[]>([])
```

The load effect currently is:

```ts
  useEffect(() => {
    if (!id) return
    getAutomations().then((all) => {
      const existing = all.find((a) => a.id === id)
      if (!existing) return
      setName(existing.name)
      setEnabled(existing.enabled)
      setTrigger(existing.trigger)
      setConditions(existing.conditions)
      setActions(existing.actions)
    })
    getAutomationHistory(id).then(setHistory)
  }, [id])
```

Add the missing line:

```ts
  useEffect(() => {
    if (!id) return
    getAutomations().then((all) => {
      const existing = all.find((a) => a.id === id)
      if (!existing) return
      setName(existing.name)
      setEnabled(existing.enabled)
      setRespectManualOff(existing.respectManualOff ?? false)
      setTrigger(existing.trigger)
      setConditions(existing.conditions)
      setActions(existing.actions)
    })
    getAutomationHistory(id).then(setHistory)
  }, [id])
```

The save handler currently builds:

```ts
      const payload = { name, enabled, trigger, conditions, actions }
```

Change to:

```ts
      const payload = { name, enabled, respectManualOff, trigger, conditions, actions }
```

- [ ] **Step 2: Add the checkbox next to "Activée"**

The current bottom row is:

```tsx
        <div className="flex items-center gap-3 pb-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Activée
          </label>
        </div>
```

Replace with (adds a second checkbox, wraps the two in a column so the explanatory text has room):

```tsx
        <div className="flex items-center gap-3 pb-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Activée
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={respectManualOff}
                onChange={(e) => setRespectManualOff(e.target.checked)}
              />
              Respecter l'extinction manuelle (ne pas rallumer avant le prochain lever du soleil)
            </label>
          </div>
        </div>
```

- [ ] **Step 3: Show skipped actions in the history view**

The current success-branch rendering in the history list is:

```tsx
                      {entry.success ? (
                        <span className="text-xs text-text-secondary">
                          {entry.actionsExecuted} action{entry.actionsExecuted > 1 ? 's' : ''}{' '}
                          exécutée
                          {entry.actionsExecuted > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-red-400">
                          {entry.error ?? "Échec de l'exécution"}
                        </span>
                      )}
```

Replace with:

```tsx
                      {entry.success ? (
                        <span className="text-xs text-text-secondary">
                          {entry.actionsExecuted} action{entry.actionsExecuted > 1 ? 's' : ''}{' '}
                          exécutée
                          {entry.actionsExecuted > 1 ? 's' : ''}
                          {entry.skippedActions ? (
                            <>
                              , {entry.skippedActions} suspendue
                              {entry.skippedActions > 1 ? 's' : ''} (extinction manuelle)
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-xs text-red-400">
                          {entry.error ?? "Échec de l'exécution"}
                        </span>
                      )}
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `npm run build && npm run lint` from the repo root.
Expected: both succeed with no new errors (the pre-existing `react-refresh/only-export-components` warning in `HueContext.tsx` is unrelated and expected).

- [ ] **Step 5: Verify visually**

Run: `npm run dev`, navigate to `/routines/new`. Expected: below "Activée", a second checkbox reads "Respecter l'extinction manuelle (ne pas rallumer avant le prochain lever du soleil)". Toggle it, save (requires `automation-engine` running to actually persist — if not running, the existing red error message appears, which is expected/correct, not a bug).

- [ ] **Step 6: Commit**

```bash
git add src/pages/AutomationForm.tsx
git commit -m "Add manual-off suppression checkbox and history display"
```

---

## Self-Review

**Spec coverage:** every section of `docs/superpowers/specs/2026-07-21-manual-off-suppression-design.md` maps to a task — data model (Automation.respectManualOff, AutomationRunLogEntry.skippedActions, suppressions collection) → Task 1, selfAttribution/suppression modules → Task 2, execution flow (detection in eventListener, enforcement in executor) → Tasks 3–4, history → Task 3 (runner) + Task 6 (display), frontend checkbox → Task 6, test scope (isSuppressed/nextSunrise only) → Task 2.

**Placeholder scan:** no TBD/TODO markers; every code block is complete and runnable. One correction made while drafting Task 3: the executor rewrite's import block initially mis-sourced `HueClient` from `./types.js` — caught and corrected to `./hueClient.js` (the actual module) before finalizing the step, with an explicit note in the task so the implementer doesn't reintroduce it from a careless copy-paste.

**Type consistency:** `ExecutionContext` (Task 3) fields (`store`, `automationId`, `respectManualOff`, `now`) are constructed identically at its only call site in `runner.ts` (also Task 3). `suppressionKey`, `isSuppressed`, `nextSunrise`, `recordManualOff` (Task 2) are used with matching signatures in `executor.ts` and `eventListener.ts` (Tasks 3–4). `markExecuted`/`wasRecentlyExecuted` (Task 2) match their call sites in `executor.ts` (Task 3) and `eventListener.ts` (Task 4). Frontend `respectManualOff`/`skippedActions` (Task 5) match their usage in `AutomationForm.tsx` (Task 6).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-manual-off-suppression-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
