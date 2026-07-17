# Automatisations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanent backend automation engine for hueDashboard so lighting automations (schedules, sunrise/sunset, Hue sensors, chained light states) run 24/7 independently of the browser, and expose them through a real Automatisations page in the frontend.

**Architecture:** A new standalone Node.js/TypeScript service, `automation-engine/`, deployed as a second Docker container next to `hue-dashboard`. It combines a 60-second cron-like scheduler (time/sun triggers) with a Hue CLIP v2 eventstream listener (sensor/light_state triggers), both funnelling into one pure rule evaluator and a shared executor. Automations and their run history persist to a JSON file on a Docker volume via lowdb. A small REST API, proxied through nginx at `/automations-api/`, lets the existing React frontend manage automations — replacing the `src/pages/Routines.tsx` placeholder.

**Tech Stack:** Node.js 20, TypeScript (NodeNext modules), Express, lowdb, suncalc, axios, Vitest (evaluator only) — backend. Existing React 18 + TypeScript + Vite + Tailwind stack — frontend.

**Spec:** `docs/superpowers/specs/2026-07-17-automatisations-design.md`

## Global Constraints

- Conditions are combined with AND only — no OR support in v1 (spec, Modèle de données).
- Automation run history is bounded to the 20 most recent entries per automation (spec, Modèle de données).
- No shared package/monorepo between frontend and backend — `automation-engine` has its own minimal Hue client, duplicated deliberately (spec, Architecture).
- `automation-engine`'s REST API is internal-only: reachable from the `hue-dashboard` container via the `hue-dashboard-default` Docker network and proxied by nginx; never published on `voxurba-network` (spec, Déploiement).
- Automated tests are scoped to the rule evaluator only (Vitest). Everything else (store, Hue client, scheduler, eventstream listener, frontend) is verified manually — there is no project-wide test suite (spec, Tests). Steps in this plan that require a live Hue bridge are marked **[MANUAL — needs real bridge]** and must be run by the user; the implementer cannot execute them without hardware.
- `automation-engine` must never crash on a Hue bridge network error — log and continue (spec, Gestion d'erreurs).
- Location (latitude/longitude for sunrise/sunset) is configured through the app UI and stored via the backend's `/config` endpoint, not through environment variables — env vars only cover bridge IP/username/port/data file path.
- `automation-engine` listens internally on port 3001.

---

## Task 1: Scaffold `automation-engine` + data model

**Files:**
- Create: `automation-engine/package.json`
- Create: `automation-engine/tsconfig.json`
- Create: `automation-engine/vitest.config.ts`
- Create: `automation-engine/.gitignore`
- Create: `automation-engine/src/types.ts`

**Interfaces:**
- Produces: every type used by every later task — `TargetKind`, `SensorEvent`, `LightUpdate`, `Trigger`, `Condition`, `Action`, `Automation`, `AutomationRunLogEntry`, `LocationConfig`, `AutomationsStoreData`, `BridgeStateSnapshot`, `FiredSensorEvent`, `FiredLightStateEvent`, `EvaluationContext`.

- [ ] **Step 1: Create the package manifest**

`automation-engine/package.json`:

```json
{
  "name": "automation-engine",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "lowdb": "^7.0.1",
    "suncalc": "^1.9.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/suncalc": "^1.9.2",
    "tsx": "^4.19.0",
    "typescript": "^5.5.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`automation-engine/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the Vitest config**

`automation-engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Create the gitignore**

`automation-engine/.gitignore`:

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Write the data model**

`automation-engine/src/types.ts`:

```ts
export type TargetKind = 'light' | 'group'

export type SensorEvent = 'motion' | 'no_motion' | 'button_press' | 'low_light' | 'bright_light'

export interface LightUpdate {
  on?: boolean
  bri?: number
  hue?: number
  sat?: number
  ct?: number
  xy?: [number, number]
}

export type Trigger =
  | { type: 'time'; hour: number; minute: number; days: number[] }
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offsetMinutes: number }
  | { type: 'sensor'; sensorId: string; event: SensorEvent }
  | { type: 'light_state'; targetId: string; targetKind: TargetKind; state: 'on' | 'off' }

export type Condition =
  | {
      type: 'time_window'
      after?: { hour: number; minute: number }
      before?: { hour: number; minute: number }
    }
  | { type: 'light_state'; targetId: string; targetKind: TargetKind; state: 'on' | 'off' }
  | { type: 'sensor_state'; sensorId: string; state: SensorEvent }

export type Action =
  | { type: 'set_light_state'; targetId: string; targetKind: TargetKind; update: LightUpdate }
  | { type: 'activate_scene'; groupId: string; sceneId: string }

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: string
}

export interface AutomationRunLogEntry {
  at: string
  success: boolean
  error?: string
  actionsExecuted: number
}

export interface LocationConfig {
  latitude: number
  longitude: number
}

export interface AutomationsStoreData {
  automations: Automation[]
  history: Record<string, AutomationRunLogEntry[]>
  config: LocationConfig | null
}

export interface BridgeStateSnapshot {
  lights: Record<string, { on: boolean }>
  groups: Record<string, { on: boolean }>
  sensors: Record<string, { state: SensorEvent | null }>
}

export type FiredSensorEvent = { kind: 'sensor'; sensorId: string; event: SensorEvent }
export type FiredLightStateEvent = {
  kind: 'light_state'
  targetId: string
  targetKind: TargetKind
  state: 'on' | 'off'
}

export interface EvaluationContext {
  now: Date
  sunTimes: { sunrise: Date; sunset: Date }
  event?: FiredSensorEvent | FiredLightStateEvent
}
```

- [ ] **Step 6: Install dependencies and verify it compiles**

Run: `cd automation-engine && npm install && npx tsc --noEmit`
Expected: no output, exit code 0 (nothing to type-check yet beyond `types.ts`, which has no logic errors).

- [ ] **Step 7: Commit**

```bash
git add automation-engine/package.json automation-engine/package-lock.json automation-engine/tsconfig.json automation-engine/vitest.config.ts automation-engine/.gitignore automation-engine/src/types.ts
git commit -m "Scaffold automation-engine service and data model"
```

## Task 2: Persistence, REST API, and bootstrap

**Files:**
- Create: `automation-engine/src/store.ts`
- Create: `automation-engine/src/api.ts`
- Create: `automation-engine/src/index.ts`
- Create: `automation-engine/.env.example`

**Interfaces:**
- Consumes: all types from `automation-engine/src/types.ts` (Task 1).
- Produces: class `AutomationStore` with methods `init(): Promise<void>`, `list(): Automation[]`, `get(id): Automation | undefined`, `create(input): Promise<Automation>`, `update(id, input): Promise<Automation | undefined>`, `remove(id): Promise<boolean>`, `toggle(id): Promise<Automation | undefined>`, `getHistory(id): AutomationRunLogEntry[]`, `appendHistory(id, entry): Promise<void>`, `getConfig(): LocationConfig | null`, `setConfig(config): Promise<void>`. Function `createApiServer(store: AutomationStore): express.Express`. Later tasks (5, 6, 7) construct `AutomationStore` and pass it around.

- [ ] **Step 1: Write the store**

`automation-engine/src/store.ts`:

```ts
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { randomUUID } from 'node:crypto'
import type { Automation, AutomationRunLogEntry, AutomationsStoreData, LocationConfig } from './types.js'

const DEFAULT_DATA: AutomationsStoreData = { automations: [], history: {}, config: null }
const MAX_HISTORY_ENTRIES = 20

export class AutomationStore {
  private db: Low<AutomationsStoreData>

  constructor(filePath: string) {
    this.db = new Low<AutomationsStoreData>(new JSONFile(filePath), DEFAULT_DATA)
  }

  async init(): Promise<void> {
    await this.db.read()
    this.db.data ||= DEFAULT_DATA
    await this.db.write()
  }

  list(): Automation[] {
    return this.db.data.automations
  }

  get(id: string): Automation | undefined {
    return this.db.data.automations.find((a) => a.id === id)
  }

  async create(input: Omit<Automation, 'id' | 'createdAt'>): Promise<Automation> {
    const automation: Automation = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    this.db.data.automations.push(automation)
    await this.db.write()
    return automation
  }

  async update(id: string, input: Omit<Automation, 'id' | 'createdAt'>): Promise<Automation | undefined> {
    const existing = this.get(id)
    if (!existing) return undefined
    const updated: Automation = { ...input, id: existing.id, createdAt: existing.createdAt }
    this.db.data.automations = this.db.data.automations.map((a) => (a.id === id ? updated : a))
    await this.db.write()
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const before = this.db.data.automations.length
    this.db.data.automations = this.db.data.automations.filter((a) => a.id !== id)
    delete this.db.data.history[id]
    await this.db.write()
    return this.db.data.automations.length < before
  }

  async toggle(id: string): Promise<Automation | undefined> {
    const existing = this.get(id)
    if (!existing) return undefined
    return this.update(id, { ...existing, enabled: !existing.enabled })
  }

  getHistory(id: string): AutomationRunLogEntry[] {
    return this.db.data.history[id] ?? []
  }

  async appendHistory(id: string, entry: AutomationRunLogEntry): Promise<void> {
    const current = this.db.data.history[id] ?? []
    this.db.data.history[id] = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES)
    await this.db.write()
  }

  getConfig(): LocationConfig | null {
    return this.db.data.config
  }

  async setConfig(config: LocationConfig): Promise<void> {
    this.db.data.config = config
    await this.db.write()
  }
}
```

- [ ] **Step 2: Write the REST API**

`automation-engine/src/api.ts`:

```ts
import express from 'express'
import type { AutomationStore } from './store.js'
import type { Automation, LocationConfig } from './types.js'

export function createApiServer(store: AutomationStore) {
  const app = express()
  app.use(express.json())

  app.get('/automations', (_req, res) => {
    res.json(store.list())
  })

  app.post('/automations', async (req, res) => {
    const input = req.body as Omit<Automation, 'id' | 'createdAt'>
    const automation = await store.create(input)
    res.status(201).json(automation)
  })

  app.put('/automations/:id', async (req, res) => {
    const input = req.body as Omit<Automation, 'id' | 'createdAt'>
    const automation = await store.update(req.params.id, input)
    if (!automation) {
      res.status(404).json({ error: 'Automatisation introuvable' })
      return
    }
    res.json(automation)
  })

  app.delete('/automations/:id', async (req, res) => {
    const removed = await store.remove(req.params.id)
    if (!removed) {
      res.status(404).json({ error: 'Automatisation introuvable' })
      return
    }
    res.status(204).end()
  })

  app.post('/automations/:id/toggle', async (req, res) => {
    const automation = await store.toggle(req.params.id)
    if (!automation) {
      res.status(404).json({ error: 'Automatisation introuvable' })
      return
    }
    res.json(automation)
  })

  app.get('/automations/:id/history', (req, res) => {
    res.json(store.getHistory(req.params.id))
  })

  app.get('/config', (_req, res) => {
    res.json(store.getConfig())
  })

  app.put('/config', async (req, res) => {
    const config = req.body as LocationConfig
    await store.setConfig(config)
    res.json(store.getConfig())
  })

  return app
}
```

- [ ] **Step 3: Write the bootstrap entrypoint (store + API only for now)**

`automation-engine/src/index.ts`:

```ts
import 'dotenv/config'
import { AutomationStore } from './store.js'
import { createApiServer } from './api.js'

const DATA_FILE = process.env.DATA_FILE ?? '/data/automations.json'
const PORT = Number(process.env.PORT ?? 3001)

async function main() {
  const store = new AutomationStore(DATA_FILE)
  await store.init()

  const app = createApiServer(store)
  app.listen(PORT, () => {
    console.log(`automation-engine écoute sur le port ${PORT}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 4: Add the env example file**

`automation-engine/.env.example`:

```
HUE_BRIDGE_IP=192.168.1.75
HUE_USERNAME=your-hue-api-username
PORT=3001
DATA_FILE=./data/automations.json
```

- [ ] **Step 5: Verify end-to-end with the real store and API (no bridge needed yet)**

Run:
```bash
cd automation-engine
mkdir -p data
DATA_FILE=./data/automations.json PORT=3001 npx tsx src/index.ts &
sleep 1
curl -s -X POST http://localhost:3001/automations \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","enabled":true,"trigger":{"type":"time","hour":7,"minute":0,"days":[]},"conditions":[],"actions":[]}'
```
Expected: JSON response with `"name":"Test"`, a generated `"id"`, and `"createdAt"`.

Continue:
```bash
curl -s http://localhost:3001/automations
```
Expected: a JSON array containing the automation just created.

```bash
curl -s -X PUT http://localhost:3001/config -H 'Content-Type: application/json' -d '{"latitude":48.85,"longitude":2.35}'
curl -s http://localhost:3001/config
```
Expected: both calls return `{"latitude":48.85,"longitude":2.35}`.

Stop the server:
```bash
kill %1
cat data/automations.json
```
Expected: the JSON file contains the automation and the config, confirming persistence survived the process.

- [ ] **Step 6: Commit**

```bash
rm -rf automation-engine/data
git add automation-engine/src/store.ts automation-engine/src/api.ts automation-engine/src/index.ts automation-engine/.env.example
git commit -m "Add automation-engine persistence, REST API, and bootstrap"
```

## Task 3: Rule evaluator (TDD)

**Files:**
- Create: `automation-engine/test/evaluator.test.ts`
- Create: `automation-engine/src/evaluator.ts`

**Interfaces:**
- Consumes: `Action`, `Automation`, `BridgeStateSnapshot`, `Condition`, `EvaluationContext`, `Trigger` from `automation-engine/src/types.ts` (Task 1).
- Produces: `matchesTrigger(trigger: Trigger, ctx: EvaluationContext): boolean`, `checkConditions(conditions: Condition[], snapshot: BridgeStateSnapshot, now: Date): boolean`, `evaluate(automation: Automation, ctx: EvaluationContext, snapshot: BridgeStateSnapshot): Action[] | null`. Task 5 (`runner.ts`) calls `evaluate`.

- [ ] **Step 1: Write the failing tests**

`automation-engine/test/evaluator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkConditions, evaluate, matchesTrigger } from '../src/evaluator.js'
import type { Automation, BridgeStateSnapshot, EvaluationContext } from '../src/types.js'

const emptySnapshot: BridgeStateSnapshot = { lights: {}, groups: {}, sensors: {} }

describe('matchesTrigger', () => {
  it('matches a time trigger on the exact hour/minute with no day restriction', () => {
    const trigger = { type: 'time' as const, hour: 7, minute: 0, days: [] }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 7, 0), // jeudi 1er janvier 2026
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(true)
  })

  it('rejects a time trigger when the day of week does not match', () => {
    const trigger = { type: 'time' as const, hour: 7, minute: 0, days: [1, 2, 3, 4, 5] } // lun-ven
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 3, 7, 0), // samedi 3 janvier 2026
      sunTimes: { sunrise: new Date(2026, 0, 3, 8, 0), sunset: new Date(2026, 0, 3, 17, 0) },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(false)
  })

  it('matches a sun trigger with a negative offset before sunset', () => {
    const trigger = { type: 'sun' as const, event: 'sunset' as const, offsetMinutes: -30 }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 16, 30),
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(true)
  })

  it('rejects a sun trigger outside the offset-adjusted minute', () => {
    const trigger = { type: 'sun' as const, event: 'sunset' as const, offsetMinutes: -30 }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 16, 0),
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(false)
  })

  it('matches a sensor trigger only when the fired event corresponds', () => {
    const trigger = { type: 'sensor' as const, sensorId: '2', event: 'motion' as const }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 12, 0),
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
      event: { kind: 'sensor', sensorId: '2', event: 'motion' },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(true)
    expect(
      matchesTrigger(trigger, { ...ctx, event: { kind: 'sensor', sensorId: '3', event: 'motion' } })
    ).toBe(false)
  })

  it('matches a light_state trigger only when the fired event corresponds', () => {
    const trigger = {
      type: 'light_state' as const,
      targetId: '5',
      targetKind: 'light' as const,
      state: 'on' as const,
    }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 12, 0),
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
      event: { kind: 'light_state', targetId: '5', targetKind: 'light', state: 'on' },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(true)
    expect(
      matchesTrigger(trigger, {
        ...ctx,
        event: { kind: 'light_state', targetId: '5', targetKind: 'light', state: 'off' },
      })
    ).toBe(false)
  })

  it('does not match a time trigger against a sensor-fired context with no time match', () => {
    const trigger = { type: 'time' as const, hour: 7, minute: 0, days: [] }
    const ctx: EvaluationContext = {
      now: new Date(2026, 0, 1, 12, 0),
      sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
      event: { kind: 'sensor', sensorId: '2', event: 'motion' },
    }
    expect(matchesTrigger(trigger, ctx)).toBe(false)
  })
})

describe('checkConditions', () => {
  it('returns true when there are no conditions', () => {
    expect(checkConditions([], emptySnapshot, new Date(2026, 0, 1, 12, 0))).toBe(true)
  })

  it('combines conditions with AND — fails if any condition fails', () => {
    const snapshot: BridgeStateSnapshot = { lights: { '1': { on: false } }, groups: {}, sensors: {} }
    const conditions = [
      { type: 'time_window' as const, after: { hour: 20, minute: 0 } },
      { type: 'light_state' as const, targetId: '1', targetKind: 'light' as const, state: 'on' as const },
    ]
    expect(checkConditions(conditions, snapshot, new Date(2026, 0, 1, 21, 0))).toBe(false)
  })

  it('passes a time_window condition within the window and fails outside it', () => {
    const conditions = [
      { type: 'time_window' as const, after: { hour: 20, minute: 0 }, before: { hour: 23, minute: 0 } },
    ]
    expect(checkConditions(conditions, emptySnapshot, new Date(2026, 0, 1, 21, 0))).toBe(true)
    expect(checkConditions(conditions, emptySnapshot, new Date(2026, 0, 1, 19, 0))).toBe(false)
  })

  it('fails a sensor_state condition when the sensor is unknown', () => {
    const conditions = [{ type: 'sensor_state' as const, sensorId: '9', state: 'motion' as const }]
    expect(checkConditions(conditions, emptySnapshot, new Date(2026, 0, 1, 12, 0))).toBe(false)
  })
})

describe('evaluate', () => {
  const baseAutomation: Automation = {
    id: 'a1',
    name: 'Test',
    enabled: true,
    trigger: { type: 'time', hour: 7, minute: 0, days: [] },
    conditions: [],
    actions: [{ type: 'set_light_state', targetId: '1', targetKind: 'light', update: { on: true } }],
    createdAt: new Date(2026, 0, 1).toISOString(),
  }

  const matchingCtx: EvaluationContext = {
    now: new Date(2026, 0, 1, 7, 0),
    sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
  }

  it('returns the actions when trigger matches and conditions pass', () => {
    expect(evaluate(baseAutomation, matchingCtx, emptySnapshot)).toEqual(baseAutomation.actions)
  })

  it('returns null when the automation is disabled', () => {
    expect(evaluate({ ...baseAutomation, enabled: false }, matchingCtx, emptySnapshot)).toBeNull()
  })

  it('returns null when the trigger does not match', () => {
    const nonMatchingCtx = { ...matchingCtx, now: new Date(2026, 0, 1, 8, 0) }
    expect(evaluate(baseAutomation, nonMatchingCtx, emptySnapshot)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd automation-engine && npm test`
Expected: FAIL — `Cannot find module '../src/evaluator.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the evaluator implementation**

`automation-engine/src/evaluator.ts`:

```ts
import type { Action, Automation, BridgeStateSnapshot, Condition, EvaluationContext, Trigger } from './types.js'

export function matchesTrigger(trigger: Trigger, ctx: EvaluationContext): boolean {
  if (trigger.type === 'time') {
    const dayMatches = trigger.days.length === 0 || trigger.days.includes(ctx.now.getDay())
    return dayMatches && trigger.hour === ctx.now.getHours() && trigger.minute === ctx.now.getMinutes()
  }
  if (trigger.type === 'sun') {
    const base = trigger.event === 'sunrise' ? ctx.sunTimes.sunrise : ctx.sunTimes.sunset
    const target = new Date(base.getTime() + trigger.offsetMinutes * 60_000)
    return isSameMinute(ctx.now, target)
  }
  if (trigger.type === 'sensor') {
    return (
      ctx.event?.kind === 'sensor' && ctx.event.sensorId === trigger.sensorId && ctx.event.event === trigger.event
    )
  }
  // trigger.type === 'light_state'
  return (
    ctx.event?.kind === 'light_state' &&
    ctx.event.targetId === trigger.targetId &&
    ctx.event.targetKind === trigger.targetKind &&
    ctx.event.state === trigger.state
  )
}

export function checkConditions(conditions: Condition[], snapshot: BridgeStateSnapshot, now: Date): boolean {
  return conditions.every((condition) => checkCondition(condition, snapshot, now))
}

function checkCondition(condition: Condition, snapshot: BridgeStateSnapshot, now: Date): boolean {
  if (condition.type === 'time_window') {
    const minutes = now.getHours() * 60 + now.getMinutes()
    const afterMinutes = condition.after ? condition.after.hour * 60 + condition.after.minute : null
    const beforeMinutes = condition.before ? condition.before.hour * 60 + condition.before.minute : null
    if (afterMinutes !== null && minutes < afterMinutes) return false
    if (beforeMinutes !== null && minutes > beforeMinutes) return false
    return true
  }
  if (condition.type === 'light_state') {
    const target =
      condition.targetKind === 'light' ? snapshot.lights[condition.targetId] : snapshot.groups[condition.targetId]
    if (!target) return false
    return (target.on ? 'on' : 'off') === condition.state
  }
  // condition.type === 'sensor_state'
  const sensor = snapshot.sensors[condition.sensorId]
  if (!sensor) return false
  return sensor.state === condition.state
}

export function evaluate(
  automation: Automation,
  ctx: EvaluationContext,
  snapshot: BridgeStateSnapshot
): Action[] | null {
  if (!automation.enabled) return null
  if (!matchesTrigger(automation.trigger, ctx)) return null
  if (!checkConditions(automation.conditions, snapshot, ctx.now)) return null
  return automation.actions
}

function isSameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd automation-engine && npm test`
Expected: PASS — all tests in `evaluator.test.ts` green (13 tests).

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/evaluator.ts automation-engine/test/evaluator.test.ts
git commit -m "Add pure rule evaluator with unit tests"
```

## Task 4: Hue client and bridge state snapshot

**Files:**
- Create: `automation-engine/src/hueClient.ts`
- Create: `automation-engine/src/snapshot.ts`

**Interfaces:**
- Consumes: `SensorEvent`, `BridgeStateSnapshot` from `automation-engine/src/types.ts` (Task 1).
- Produces: class `HueClient` (constructor `{ bridgeIp: string; username: string }`) with methods `getLights(): Promise<Record<string, { on: boolean; bri: number; reachable: boolean }>>`, `getGroups(): Promise<Record<string, { any_on: boolean; all_on: boolean }>>`, `getSensors(): Promise<Record<string, { id: string; name: string; type: string; state: Record<string, unknown> }>>`, `setLightState(lightId, update)`, `setGroupState(groupId, update)`, `activateScene(groupId, sceneId)`. Function `buildSnapshot(client: HueClient): Promise<BridgeStateSnapshot>`. Tasks 5, 6, 7 consume both.

- [ ] **Step 1: Write the Hue client**

`automation-engine/src/hueClient.ts`:

```ts
import axios, { type AxiosInstance } from 'axios'

export interface HueClientConfig {
  bridgeIp: string
  username: string
}

export interface HueLightState {
  on: boolean
  bri: number
  reachable: boolean
}

export interface HueGroupState {
  any_on: boolean
  all_on: boolean
}

export interface HueSensor {
  id: string
  name: string
  type: string
  state: Record<string, unknown>
}

export class HueClient {
  private http: AxiosInstance

  constructor(config: HueClientConfig) {
    this.http = axios.create({
      baseURL: `http://${config.bridgeIp}/api/${config.username}`,
      timeout: 5000,
    })
  }

  async getLights(): Promise<Record<string, HueLightState>> {
    const { data } = await this.http.get<Record<string, { state: HueLightState }>>('/lights')
    return Object.fromEntries(Object.entries(data).map(([id, l]) => [id, l.state]))
  }

  async getGroups(): Promise<Record<string, HueGroupState>> {
    const { data } = await this.http.get<Record<string, { state: HueGroupState }>>('/groups')
    return Object.fromEntries(Object.entries(data).map(([id, g]) => [id, g.state]))
  }

  async getSensors(): Promise<Record<string, HueSensor>> {
    const { data } = await this.http.get<Record<string, Omit<HueSensor, 'id'>>>('/sensors')
    return Object.fromEntries(Object.entries(data).map(([id, s]) => [id, { id, ...s }]))
  }

  async setLightState(lightId: string, update: Record<string, unknown>): Promise<void> {
    await this.http.put(`/lights/${lightId}/state`, update)
  }

  async setGroupState(groupId: string, update: Record<string, unknown>): Promise<void> {
    await this.http.put(`/groups/${groupId}/action`, update)
  }

  async activateScene(groupId: string, sceneId: string): Promise<void> {
    await this.http.put(`/groups/${groupId}/action`, { scene: sceneId })
  }
}
```

- [ ] **Step 2: Write the snapshot builder**

`automation-engine/src/snapshot.ts`:

```ts
import type { HueClient, HueSensor } from './hueClient.js'
import type { BridgeStateSnapshot, SensorEvent } from './types.js'

export async function buildSnapshot(client: HueClient): Promise<BridgeStateSnapshot> {
  const [lights, groups, sensors] = await Promise.all([
    client.getLights(),
    client.getGroups(),
    client.getSensors(),
  ])

  const sensorStates: Record<string, { state: SensorEvent | null }> = {}
  for (const [id, sensor] of Object.entries(sensors)) {
    sensorStates[id] = { state: mapSensorState(sensor) }
  }

  return {
    lights: Object.fromEntries(Object.entries(lights).map(([id, s]) => [id, { on: s.on }])),
    groups: Object.fromEntries(Object.entries(groups).map(([id, s]) => [id, { on: s.any_on }])),
    sensors: sensorStates,
  }
}

function mapSensorState(sensor: HueSensor): SensorEvent | null {
  if (sensor.type === 'ZLLPresence') {
    return sensor.state.presence ? 'motion' : 'no_motion'
  }
  if (sensor.type === 'ZLLLightLevel') {
    return sensor.state.dark ? 'low_light' : 'bright_light'
  }
  return null
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: [MANUAL — needs real bridge] Verify against the physical bridge**

This step needs your real Hue bridge IP and API username (the same `VITE_HUE_USERNAME` from the root `.env.local`) — run it yourself, the implementer has no bridge access:

```bash
cd automation-engine
cat > /tmp/verify-hue-client.mjs <<'EOF'
import { HueClient } from './dist/hueClient.js'
import { buildSnapshot } from './dist/snapshot.js'

const client = new HueClient({ bridgeIp: process.env.HUE_BRIDGE_IP, username: process.env.HUE_USERNAME })
const snapshot = await buildSnapshot(client)
console.log(JSON.stringify(snapshot, null, 2))
EOF
npm run build
HUE_BRIDGE_IP=<votre IP bridge> HUE_USERNAME=<votre username> node /tmp/verify-hue-client.mjs
```
Expected: JSON with real `lights`, `groups`, `sensors` keyed by your bridge's actual IDs, each light/group having a boolean `on`, and any Hue motion/light-level sensors showing `"motion"`/`"no_motion"` or `"low_light"`/`"bright_light"`.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/hueClient.ts automation-engine/src/snapshot.ts
git commit -m "Add server-side Hue client and bridge state snapshot builder"
```

## Task 5: Action executor and tick runner

**Files:**
- Create: `automation-engine/src/executor.ts`
- Create: `automation-engine/src/runner.ts`

**Interfaces:**
- Consumes: `HueClient` (Task 4), `buildSnapshot` (Task 4), `evaluate` (Task 3), `AutomationStore` (Task 2), `Action`, `EvaluationContext`, `BridgeStateSnapshot` (Task 1).
- Produces: `executeActions(client: HueClient, actions: Action[]): Promise<void>`. `runTick(store: AutomationStore, client: HueClient, ctx: EvaluationContext, snapshot?: BridgeStateSnapshot): Promise<void>`. Tasks 6 and 7 both call `runTick`.

- [ ] **Step 1: Write the executor**

`automation-engine/src/executor.ts`:

```ts
import type { HueClient } from './hueClient.js'
import type { Action } from './types.js'

export async function executeActions(client: HueClient, actions: Action[]): Promise<void> {
  for (const action of actions) {
    if (action.type === 'set_light_state') {
      if (action.targetKind === 'light') {
        await client.setLightState(action.targetId, action.update)
      } else {
        await client.setGroupState(action.targetId, action.update)
      }
    } else {
      await client.activateScene(action.groupId, action.sceneId)
    }
  }
}
```

- [ ] **Step 2: Write the tick runner**

`automation-engine/src/runner.ts`. Note the `try/catch` around the snapshot fetch: if the bridge is unreachable, `buildSnapshot` throws — this must not crash the caller (scheduler/eventListener), so the tick is skipped and logged instead, per the spec's error-handling requirement.

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
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify error handling without a bridge (no hardware needed)**

This step deliberately points at an unreachable address to confirm `runTick` never throws:

```bash
cd automation-engine
npm run build
cat > /tmp/verify-runner.mjs <<'EOF'
import { AutomationStore } from './dist/store.js'
import { HueClient } from './dist/hueClient.js'
import { runTick } from './dist/runner.js'

const store = new AutomationStore('/tmp/verify-automations.json')
await store.init()
await store.create({
  name: 'Test',
  enabled: true,
  trigger: { type: 'time', hour: 7, minute: 0, days: [] },
  conditions: [],
  actions: [{ type: 'set_light_state', targetId: '1', targetKind: 'light', update: { on: true } }],
})

const client = new HueClient({ bridgeIp: '10.255.255.1', username: 'unreachable' })
await runTick(store, client, {
  now: new Date(2026, 0, 1, 7, 0),
  sunTimes: { sunrise: new Date(2026, 0, 1, 8, 0), sunset: new Date(2026, 0, 1, 17, 0) },
})
console.log('runTick completed without throwing')
EOF
node /tmp/verify-runner.mjs
rm /tmp/verify-automations.json
```
Expected: a `Bridge Hue injoignable, tick ignoré : ...` log line followed by `runTick completed without throwing` — no unhandled exception, no crash.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/executor.ts automation-engine/src/runner.ts
git commit -m "Add action executor and tick runner with bridge-failure handling"
```

## Task 6: Scheduler for time/sun triggers

**Files:**
- Create: `automation-engine/src/scheduler.ts`
- Modify: `automation-engine/src/index.ts` (full replacement — adds the scheduler)

**Interfaces:**
- Consumes: `AutomationStore` (Task 2), `HueClient` (Task 4), `runTick` (Task 5).
- Produces: `startScheduler(store: AutomationStore, client: HueClient): () => void` (the returned function stops the interval). Task 7 wires alongside this in `index.ts`.

- [ ] **Step 1: Write the scheduler**

`automation-engine/src/scheduler.ts`. Reads the location config from the store on every tick (not a static startup value) so changes made later through the `/config` endpoint take effect immediately. When no config is set yet, `sun` triggers simply never fire (epoch time never matches "now") — `time` triggers are unaffected.

```ts
import suncalc from 'suncalc'
import type { HueClient } from './hueClient.js'
import { runTick } from './runner.js'
import type { AutomationStore } from './store.js'

export function startScheduler(store: AutomationStore, client: HueClient): () => void {
  const tick = async () => {
    const config = store.getConfig()
    const now = new Date()
    const sunTimes = config
      ? suncalc.getTimes(now, config.latitude, config.longitude)
      : { sunrise: new Date(0), sunset: new Date(0) }

    await runTick(store, client, {
      now,
      sunTimes: { sunrise: sunTimes.sunrise, sunset: sunTimes.sunset },
    })
  }

  const interval = setInterval(tick, 60_000)
  return () => clearInterval(interval)
}
```

- [ ] **Step 2: Wire the scheduler into the bootstrap**

Replace `automation-engine/src/index.ts` entirely:

```ts
import 'dotenv/config'
import { HueClient } from './hueClient.js'
import { createApiServer } from './api.js'
import { startScheduler } from './scheduler.js'
import { AutomationStore } from './store.js'

const DATA_FILE = process.env.DATA_FILE ?? '/data/automations.json'
const PORT = Number(process.env.PORT ?? 3001)
const BRIDGE_IP = process.env.HUE_BRIDGE_IP
const USERNAME = process.env.HUE_USERNAME

if (!BRIDGE_IP || !USERNAME) {
  throw new Error('HUE_BRIDGE_IP et HUE_USERNAME sont requis')
}

async function main() {
  const store = new AutomationStore(DATA_FILE)
  await store.init()

  const client = new HueClient({ bridgeIp: BRIDGE_IP, username: USERNAME })
  const stopScheduler = startScheduler(store, client)

  const app = createApiServer(store)
  const server = app.listen(PORT, () => {
    console.log(`automation-engine écoute sur le port ${PORT}`)
  })

  const shutdown = () => {
    stopScheduler()
    server.close()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify the scheduler fires on schedule (no hardware needed)**

Create a `time` automation targeting one minute from now, confirm the log shows an attempt (and a graceful bridge-unreachable message, since no real bridge is configured here):

```bash
cd automation-engine
npm run build
mkdir -p /tmp/scheduler-check
cat > /tmp/scheduler-check/.env <<EOF
HUE_BRIDGE_IP=10.255.255.1
HUE_USERNAME=unreachable
DATA_FILE=/tmp/scheduler-check/automations.json
PORT=3099
EOF
(cd /tmp/scheduler-check && node /path/to/automation-engine/dist/index.js) &
sleep 1
NOW_HOUR=$(date +%H)
NOW_MIN=$(date -d '+1 minute' +%M 2>/dev/null || date -v+1M +%M)
curl -s -X POST http://localhost:3099/automations -H 'Content-Type: application/json' \
  -d "{\"name\":\"Check\",\"enabled\":true,\"trigger\":{\"type\":\"time\",\"hour\":$NOW_HOUR,\"minute\":$NOW_MIN,\"days\":[]},\"conditions\":[],\"actions\":[]}"
sleep 65
```
Expected: within the 65-second wait, a `Bridge Hue injoignable, tick ignoré : ...` log line appears — proof the scheduler ticked, matched the trigger, attempted to build a snapshot, and handled the failure gracefully rather than crashing. Stop the background process (`kill %1`) and remove `/tmp/scheduler-check` afterwards.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/scheduler.ts automation-engine/src/index.ts
git commit -m "Add time/sun scheduler and wire it into the bootstrap"
```

## Task 7: Eventstream listener for sensor/light_state triggers

**Files:**
- Create: `automation-engine/src/eventListener.ts`
- Modify: `automation-engine/src/index.ts` (full replacement — adds the listener)

**Interfaces:**
- Consumes: `AutomationStore` (Task 2), `HueClient` (Task 4), `buildSnapshot` (Task 4), `runTick` (Task 5).
- Produces: `startEventListener(store: AutomationStore, client: HueClient, config: { bridgeIp: string; username: string }): () => void`.

- [ ] **Step 1: Write the eventstream listener**

`automation-engine/src/eventListener.ts`. It subscribes to the bridge's CLIP v2 SSE eventstream. On any relevant event it does NOT trust the v2 payload's own state fields — it re-fetches a fresh v1 snapshot (`buildSnapshot`, the same one the scheduler uses) and reads the resolved state from there, keyed by the `id_v1` the v2 event reports. This keeps a single source of truth for "what does motion/light_level/on actually mean" and avoids duplicating that logic with different semantics in two places.

The bridge's TLS certificate is self-signed with no public CA (a fixed, documented characteristic of every Hue Bridge — not something we can fix on our end), so the standard chain-of-trust check must be disabled. To avoid disabling TLS validation outright, the certificate's fingerprint is pinned on first connection and checked on every reconnect (trust-on-first-use, the same model SSH uses for host keys) — if the bridge's certificate ever changes unexpectedly afterwards, the connection is refused instead of silently trusting a possibly different device.

```ts
import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import suncalc from 'suncalc'
import { runTick } from './runner.js'
import { buildSnapshot } from './snapshot.js'
import type { AutomationStore } from './store.js'
import type { HueClient } from './hueClient.js'
import type { TargetKind } from './types.js'

export interface EventListenerConfig {
  bridgeIp: string
  username: string
}

interface HueV2Event {
  type: string
  id_v1?: string
}

interface HueV2Message {
  type: string
  data: HueV2Event[]
}

export function startEventListener(
  store: AutomationStore,
  client: HueClient,
  config: EventListenerConfig
): () => void {
  let stopped = false
  let request: ReturnType<typeof https.request> | undefined
  let pinnedFingerprint: string | null = null

  const connect = () => {
    if (stopped) return
    request = https.request(
      {
        hostname: config.bridgeIp,
        path: '/eventstream/clip/v2',
        headers: { 'hue-application-key': config.username, Accept: 'text/event-stream' },
        // Le bridge Hue a un certificat auto-signé sans CA publique — la validation
        // standard est désactivée, mais remplacée par un pinning du fingerprint
        // ci-dessous (trust-on-first-use), pas par une confiance aveugle.
        rejectUnauthorized: false,
      },
      (res) => {
        const socket = res.socket as TLSSocket
        const fingerprint = socket.getPeerCertificate().fingerprint256
        if (!pinnedFingerprint) {
          pinnedFingerprint = fingerprint
          console.log('Certificat du bridge Hue épinglé (première connexion) :', fingerprint)
        } else if (fingerprint !== pinnedFingerprint) {
          console.error('Certificat du bridge Hue changé de façon inattendue — connexion refusée')
          request?.destroy()
          return
        }

        let buffer = ''
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) handleRawMessage(part)
        })
        res.on('end', scheduleReconnect)
        res.on('error', scheduleReconnect)
      }
    )
    request.on('error', scheduleReconnect)
    request.end()
  }

  const handleRawMessage = (rawEvent: string) => {
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'))
    if (!dataLine) return
    let messages: HueV2Message[]
    try {
      messages = JSON.parse(dataLine.slice('data:'.length).trim())
    } catch {
      return
    }
    for (const message of messages) {
      for (const event of message.data) {
        void handleEvent(event)
      }
    }
  }

  const handleEvent = async (event: HueV2Event) => {
    const targetId = extractV1Id(event.id_v1)
    if (!targetId) return

    const now = new Date()
    const locationConfig = store.getConfig()
    const sunTimes = locationConfig
      ? suncalc.getTimes(now, locationConfig.latitude, locationConfig.longitude)
      : { sunrise: new Date(0), sunset: new Date(0) }
    const ctxBase = { now, sunTimes: { sunrise: sunTimes.sunrise, sunset: sunTimes.sunset } }

    if (event.type === 'motion' || event.type === 'light_level') {
      const snapshot = await buildSnapshot(client)
      const sensorState = snapshot.sensors[targetId]?.state
      if (!sensorState) return
      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'sensor', sensorId: targetId, event: sensorState } },
        snapshot
      )
    } else if (event.type === 'button') {
      await runTick(store, client, {
        ...ctxBase,
        event: { kind: 'sensor', sensorId: targetId, event: 'button_press' },
      })
    } else if (event.type === 'light' || event.type === 'grouped_light') {
      const targetKind: TargetKind = event.type === 'grouped_light' ? 'group' : 'light'
      const snapshot = await buildSnapshot(client)
      const on = (targetKind === 'light' ? snapshot.lights : snapshot.groups)[targetId]?.on
      if (on === undefined) return
      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'light_state', targetId, targetKind, state: on ? 'on' : 'off' } },
        snapshot
      )
    }
  }

  const scheduleReconnect = () => {
    if (stopped) return
    setTimeout(connect, 5000)
  }

  connect()

  return () => {
    stopped = true
    request?.destroy()
  }
}

function extractV1Id(idV1: string | undefined): string | undefined {
  if (!idV1) return undefined
  const segments = idV1.split('/')
  return segments[segments.length - 1]
}
```

- [ ] **Step 2: Wire the listener into the bootstrap**

Replace `automation-engine/src/index.ts` entirely:

```ts
import 'dotenv/config'
import { createApiServer } from './api.js'
import { startEventListener } from './eventListener.js'
import { HueClient } from './hueClient.js'
import { startScheduler } from './scheduler.js'
import { AutomationStore } from './store.js'

const DATA_FILE = process.env.DATA_FILE ?? '/data/automations.json'
const PORT = Number(process.env.PORT ?? 3001)
const BRIDGE_IP = process.env.HUE_BRIDGE_IP
const USERNAME = process.env.HUE_USERNAME

if (!BRIDGE_IP || !USERNAME) {
  throw new Error('HUE_BRIDGE_IP et HUE_USERNAME sont requis')
}

async function main() {
  const store = new AutomationStore(DATA_FILE)
  await store.init()

  const client = new HueClient({ bridgeIp: BRIDGE_IP, username: USERNAME })
  const stopScheduler = startScheduler(store, client)
  const stopEventListener = startEventListener(store, client, { bridgeIp: BRIDGE_IP, username: USERNAME })

  const app = createApiServer(store)
  const server = app.listen(PORT, () => {
    console.log(`automation-engine écoute sur le port ${PORT}`)
  })

  const shutdown = () => {
    stopScheduler()
    stopEventListener()
    server.close()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Verify it compiles**

Run: `cd automation-engine && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: [MANUAL — needs real bridge] Verify the eventstream reacts to a real sensor**

Run yourself, with a Hue motion sensor on your bridge:

```bash
cd automation-engine
npm run build
HUE_BRIDGE_IP=<votre IP bridge> HUE_USERNAME=<votre username> DATA_FILE=/tmp/event-check.json PORT=3099 node dist/index.js
```
In another terminal, create a `sensor` automation for that sensor's v1 id (find it via `curl http://<bridge-ip>/api/<username>/sensors`), then walk in front of the physical sensor. Expected: within roughly a second, a `Bridge Hue injoignable` or a successful history append log appears (depending on whether real light/group targets are configured in the automation's actions) — confirming the SSE event round-tripped through `id_v1` extraction, `buildSnapshot`, and `runTick`.

- [ ] **Step 5: Commit**

```bash
git add automation-engine/src/eventListener.ts automation-engine/src/index.ts
git commit -m "Add CLIP v2 eventstream listener for sensor and light_state triggers"
```

## Task 8: Frontend types and API client for automations

**Files:**
- Create: `src/types/automation.ts`
- Create: `src/api/automations.ts`

**Interfaces:**
- Consumes: nothing new — mirrors `automation-engine/src/types.ts` (Task 1) on the frontend side, per the spec's accepted front/backend duplication.
- Produces: types `TargetKind`, `SensorEvent`, `LightUpdate`, `Trigger`, `Condition`, `Action`, `Automation`, `AutomationRunLogEntry`, `LocationConfig`. Functions `getAutomations()`, `createAutomation(input)`, `updateAutomation(id, input)`, `deleteAutomation(id)`, `toggleAutomation(id)`, `getAutomationHistory(id)`, `getLocationConfig()`, `setLocationConfig(config)`. Tasks 9, 10, 11 import from `src/api/automations.ts` and `src/types/automation.ts`.

- [ ] **Step 1: Write the frontend types**

`src/types/automation.ts`:

```ts
export type TargetKind = 'light' | 'group'

export type SensorEvent = 'motion' | 'no_motion' | 'button_press' | 'low_light' | 'bright_light'

export interface LightUpdate {
  on?: boolean
  bri?: number
  hue?: number
  sat?: number
  ct?: number
  xy?: [number, number]
}

export type Trigger =
  | { type: 'time'; hour: number; minute: number; days: number[] }
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offsetMinutes: number }
  | { type: 'sensor'; sensorId: string; event: SensorEvent }
  | { type: 'light_state'; targetId: string; targetKind: TargetKind; state: 'on' | 'off' }

export type Condition =
  | {
      type: 'time_window'
      after?: { hour: number; minute: number }
      before?: { hour: number; minute: number }
    }
  | { type: 'light_state'; targetId: string; targetKind: TargetKind; state: 'on' | 'off' }
  | { type: 'sensor_state'; sensorId: string; state: SensorEvent }

export type Action =
  | { type: 'set_light_state'; targetId: string; targetKind: TargetKind; update: LightUpdate }
  | { type: 'activate_scene'; groupId: string; sceneId: string }

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: string
}

export interface AutomationRunLogEntry {
  at: string
  success: boolean
  error?: string
  actionsExecuted: number
}

export interface LocationConfig {
  latitude: number
  longitude: number
}
```

- [ ] **Step 2: Write the API client**

`src/api/automations.ts`. Requests go through nginx's `/automations-api/` proxy (added in Task 12), not directly to the bridge — same pattern as `/hue-bridge/` in `src/api/hue.ts`.

```ts
import axios from 'axios'
import type { Automation, AutomationRunLogEntry, LocationConfig } from '../types/automation'

const client = axios.create({ baseURL: '/automations-api', timeout: 5000 })

export async function getAutomations(): Promise<Automation[]> {
  const { data } = await client.get<Automation[]>('/automations')
  return data
}

export async function createAutomation(input: Omit<Automation, 'id' | 'createdAt'>): Promise<Automation> {
  const { data } = await client.post<Automation>('/automations', input)
  return data
}

export async function updateAutomation(
  id: string,
  input: Omit<Automation, 'id' | 'createdAt'>
): Promise<Automation> {
  const { data } = await client.put<Automation>(`/automations/${id}`, input)
  return data
}

export async function deleteAutomation(id: string): Promise<void> {
  await client.delete(`/automations/${id}`)
}

export async function toggleAutomation(id: string): Promise<Automation> {
  const { data } = await client.post<Automation>(`/automations/${id}/toggle`)
  return data
}

export async function getAutomationHistory(id: string): Promise<AutomationRunLogEntry[]> {
  const { data } = await client.get<AutomationRunLogEntry[]>(`/automations/${id}/history`)
  return data
}

export async function getLocationConfig(): Promise<LocationConfig | null> {
  const { data } = await client.get<LocationConfig | null>('/config')
  return data
}

export async function setLocationConfig(config: LocationConfig): Promise<LocationConfig> {
  const { data } = await client.put<LocationConfig>('/config', config)
  return data
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors (these two new files aren't imported anywhere yet, so `noUnusedLocals`/ESLint's unused-export rules don't apply to unused exports — only unused local variables/imports, of which there are none here).

- [ ] **Step 4: Commit**

```bash
git add src/types/automation.ts src/api/automations.ts
git commit -m "Add frontend types and API client for automations"
```

## Task 9: Location settings for sunrise/sunset triggers

**Files:**
- Modify: `src/pages/Settings.tsx` (full replacement)

**Interfaces:**
- Consumes: `getLocationConfig`, `setLocationConfig` from `src/api/automations.ts` (Task 8).
- Produces: nothing consumed by later tasks — this is a leaf UI change.

- [ ] **Step 1: Add a "Localisation" section to Settings**

Replace `src/pages/Settings.tsx` entirely — it adds a new section between "Bridge Philips Hue" and "Statut" for the latitude/longitude used by `sun` triggers, loaded from and saved to `automation-engine`'s `/config` endpoint via Task 8's client:

```tsx
import { useEffect, useState } from 'react'
import { CheckCircle, MapPin, RefreshCw, Trash2, Wifi } from 'lucide-react'
import { useHue } from '../context/HueContext'
import { getLocationConfig, setLocationConfig } from '../api/automations'

export default function Settings() {
  const { config, setConfig, refresh, loading } = useHue()
  const [ip, setIp] = useState(config?.ip ?? '')
  const [username, setUsername] = useState(config?.username ?? '')
  const [saved, setSaved] = useState(false)

  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationSaved, setLocationSaved] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  useEffect(() => {
    getLocationConfig()
      .then((location) => {
        if (location) {
          setLatitude(String(location.latitude))
          setLongitude(String(location.longitude))
        }
      })
      .catch(() => setLocationError("Impossible de contacter le service d'automatisations."))
  }, [])

  const handleSave = () => {
    if (ip && username) {
      setConfig({ ip, username })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleSaveLocation = async () => {
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setLocationError('Latitude et longitude doivent être des nombres.')
      return
    }
    setLocationError(null)
    try {
      await setLocationConfig({ latitude: lat, longitude: lng })
      setLocationSaved(true)
      setTimeout(() => setLocationSaved(false), 2000)
    } catch {
      setLocationError("Impossible de contacter le service d'automatisations.")
    }
  }

  const handleReset = () => {
    localStorage.removeItem('hue_bridge_config')
    window.location.reload()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0">
        <h1 className="text-2xl font-bold text-white">Paramètres</h1>
        <p className="text-sm text-text-secondary mt-1">Configuration du bridge Hue</p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6 max-w-lg">
        {/* Bridge config */}
        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-orange/20 flex items-center justify-center">
              <Wifi size={18} className="text-accent-orange" />
            </div>
            <h2 className="font-semibold text-white">Bridge Philips Hue</h2>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Adresse IP du bridge
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.x"
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Clé API (username)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Votre clé API Hue"
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted font-mono text-xs"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!ip || !username}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50"
              >
                {saved ? <CheckCircle size={15} /> : null}
                {saved ? 'Enregistré !' : 'Enregistrer'}
              </button>
              <button
                onClick={refresh}
                disabled={loading || !config}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-hover text-text-secondary text-sm font-medium transition-all hover:text-white"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                Actualiser
              </button>
            </div>
          </div>
        </section>

        {/* Location for sunrise/sunset triggers */}
        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-purple/20 flex items-center justify-center">
              <MapPin size={18} className="text-accent-purple" />
            </div>
            <h2 className="font-semibold text-white">Localisation</h2>
          </div>
          <p className="text-xs text-text-secondary -mt-2">
            Utilisée pour calculer les horaires de lever et coucher du soleil dans les
            automatisations.
          </p>

          {locationError && <p className="text-sm text-red-400">{locationError}</p>}

          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-text-secondary mb-2 block">Latitude</label>
                <input
                  type="text"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="48.8566"
                  className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-text-secondary mb-2 block">Longitude</label>
                <input
                  type="text"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="2.3522"
                  className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                />
              </div>
            </div>
            <button
              onClick={handleSaveLocation}
              disabled={!latitude || !longitude}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50 self-start"
            >
              {locationSaved ? <CheckCircle size={15} /> : null}
              {locationSaved ? 'Enregistré !' : 'Enregistrer'}
            </button>
          </div>
        </section>

        {/* Status */}
        {config && (
          <section className="bg-bg-card rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">Statut</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Bridge IP</span>
                <span className="text-sm font-mono text-white">{config.ip}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Connexion</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                  <span className="text-sm text-accent-green">Connecté</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
          <h2 className="font-semibold text-red-400 mb-3">Zone de danger</h2>
          <p className="text-sm text-text-secondary mb-4">
            Réinitialiser la configuration supprimera toutes les données enregistrées.
          </p>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/40 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-all"
          >
            <Trash2 size={15} />
            Réinitialiser la configuration
          </button>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 3: Verify visually**

Run: `npm run dev`, navigate to `/settings`. Expected: a new "Localisation" section appears between "Bridge Philips Hue" and "Statut" with latitude/longitude fields and a save button. Saving without `automation-engine` running shows the red error message (expected — the backend isn't deployed yet at this point in the plan).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "Add location settings for sunrise/sunset automation triggers"
```

## Task 10: Automations list page

**Files:**
- Modify: `src/pages/Routines.tsx` (full replacement — was the static mock placeholder)

**Interfaces:**
- Consumes: `getAutomations`, `toggleAutomation`, `deleteAutomation` from `src/api/automations.ts` (Task 8); `Automation` from `src/types/automation.ts` (Task 8).
- Produces: links to `/routines/new` and `/routines/:id`, which Task 11 wires up in `App.tsx` alongside creating the `AutomationForm` component they point to.

- [ ] **Step 1: Replace the placeholder with a real list page**

Replace `src/pages/Routines.tsx` entirely:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Lightbulb, Plus, Radar, Sun, Trash2 } from 'lucide-react'
import { deleteAutomation, getAutomations, toggleAutomation } from '../api/automations'
import type { Automation } from '../types/automation'

const TRIGGER_ICONS = {
  time: Clock,
  sun: Sun,
  sensor: Radar,
  light_state: Lightbulb,
} as const

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function describeTrigger(automation: Automation): string {
  const { trigger } = automation
  if (trigger.type === 'time') {
    const days = trigger.days.length === 0 ? 'Tous les jours' : trigger.days.map((d) => DAY_LABELS[d]).join(', ')
    const time = `${String(trigger.hour).padStart(2, '0')}:${String(trigger.minute).padStart(2, '0')}`
    return `${time} · ${days}`
  }
  if (trigger.type === 'sun') {
    const label = trigger.event === 'sunrise' ? 'lever du soleil' : 'coucher du soleil'
    const offset =
      trigger.offsetMinutes === 0 ? '' : ` (${trigger.offsetMinutes > 0 ? '+' : ''}${trigger.offsetMinutes} min)`
    return `Au ${label}${offset}`
  }
  if (trigger.type === 'sensor') {
    return `Capteur ${trigger.sensorId} · ${trigger.event}`
  }
  return `Lampe/groupe ${trigger.targetId} passe ${trigger.state === 'on' ? 'allumé' : 'éteint'}`
}

export default function Routines() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setAutomations(await getAutomations())
    } catch {
      setError("Impossible de contacter le service d'automatisations.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleToggle = async (id: string) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)))
    await toggleAutomation(id)
  }

  const handleDelete = async (id: string) => {
    setAutomations((prev) => prev.filter((a) => a.id !== id))
    await deleteAutomation(id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Automatisations</h1>
          <p className="text-sm text-text-secondary mt-1">Automatisez vos lumières</p>
        </div>
        <Link
          to="/routines/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all"
        >
          <Plus size={16} />
          Nouvelle automatisation
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-3 max-w-2xl">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && automations.length === 0 && (
          <p className="text-sm text-text-secondary">Aucune automatisation pour l'instant.</p>
        )}
        {automations.map((automation) => {
          const Icon = TRIGGER_ICONS[automation.trigger.type]
          return (
            <div key={automation.id} className="bg-bg-card rounded-2xl p-5 flex items-center gap-4">
              <Link
                to={`/routines/${automation.id}`}
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-accent-orange/20"
              >
                <Icon size={18} className="text-accent-orange" />
              </Link>
              <Link to={`/routines/${automation.id}`} className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{automation.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">{describeTrigger(automation)}</p>
              </Link>
              <button
                onClick={() => handleDelete(automation.id)}
                className="text-text-secondary hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => handleToggle(automation.id)}
                className="relative w-11 h-6 rounded-full transition-all shrink-0"
                style={{ background: automation.enabled ? '#FFB347' : '#2E2E3F' }}
              >
                <span
                  className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                  style={{ left: automation.enabled ? 'calc(100% - 20px)' : '4px' }}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors. (The `/routines/new` and `/routines/:id` links aren't wired to a route yet — that's Task 11 — but that doesn't affect compilation; clicking them would 404 in the browser until then.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/Routines.tsx
git commit -m "Replace routines placeholder with a real automations list page"
```

## Task 11: Automation create/edit form

**Files:**
- Create: `src/pages/AutomationForm.tsx`
- Modify: `src/App.tsx` (add the two routes pointing at it)

**Interfaces:**
- Consumes: `getAutomations`, `createAutomation`, `updateAutomation` from `src/api/automations.ts` (Task 8); `Action`, `Automation`, `Condition`, `SensorEvent`, `Trigger` from `src/types/automation.ts` (Task 8); `useHue` from `src/context/HueContext.tsx` (existing) for the lights/groups/scenes pickers.
- Produces: nothing consumed by later tasks — this is the last frontend piece.

- [ ] **Step 1: Write the form**

`src/pages/AutomationForm.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useHue } from '../context/HueContext'
import { createAutomation, getAutomations, updateAutomation } from '../api/automations'
import type { Action, Condition, SensorEvent, Trigger } from '../types/automation'

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function defaultTrigger(): Trigger {
  return { type: 'time', hour: 7, minute: 0, days: [] }
}

function defaultCondition(): Condition {
  return { type: 'time_window', after: { hour: 20, minute: 0 } }
}

function defaultAction(): Action {
  return { type: 'set_light_state', targetId: '', targetKind: 'light', update: { on: true } }
}

export default function AutomationForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { lights, groups, scenes } = useHue()
  const isEditing = Boolean(id)

  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [trigger, setTrigger] = useState<Trigger>(defaultTrigger())
  const [conditions, setConditions] = useState<Condition[]>([])
  const [actions, setActions] = useState<Action[]>([defaultAction()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [id])

  const handleSave = async () => {
    if (!name || actions.length === 0) {
      setError('Le nom et au moins une action sont requis.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name, enabled, trigger, conditions, actions }
      if (isEditing && id) {
        await updateAutomation(id, payload)
      } else {
        await createAutomation(payload)
      }
      navigate('/routines')
    } catch {
      setError("Impossible d'enregistrer l'automatisation.")
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day: number) => {
    if (trigger.type !== 'time') return
    const days = trigger.days.includes(day) ? trigger.days.filter((d) => d !== day) : [...trigger.days, day]
    setTrigger({ ...trigger, days })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-7 pb-5 shrink-0">
        <button
          onClick={() => navigate('/routines')}
          className="flex items-center gap-2 text-text-secondary hover:text-white transition-colors mb-5 text-sm"
        >
          <ArrowLeft size={16} />
          Retour
        </button>
        <h1 className="text-2xl font-bold text-white">
          {isEditing ? "Modifier l'automatisation" : 'Nouvelle automatisation'}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6 max-w-2xl">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <label className="text-xs font-medium text-text-secondary">Nom</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Réveil progressif"
            className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
          />
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="font-semibold text-white">Déclencheur</h2>
          <select
            value={trigger.type}
            onChange={(e) => {
              const type = e.target.value as Trigger['type']
              if (type === 'time') setTrigger({ type: 'time', hour: 7, minute: 0, days: [] })
              else if (type === 'sun') setTrigger({ type: 'sun', event: 'sunset', offsetMinutes: 0 })
              else if (type === 'sensor') setTrigger({ type: 'sensor', sensorId: '', event: 'motion' })
              else setTrigger({ type: 'light_state', targetId: '', targetKind: 'light', state: 'on' })
            }}
            className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange"
          >
            <option value="time">Heure fixe</option>
            <option value="sun">Lever / coucher du soleil</option>
            <option value="sensor">Capteur Hue</option>
            <option value="light_state">État d'une lampe/groupe</option>
          </select>

          {trigger.type === 'time' && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={trigger.hour}
                  onChange={(e) => setTrigger({ ...trigger, hour: Number(e.target.value) })}
                  className="w-20 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={trigger.minute}
                  onChange={(e) => setTrigger({ ...trigger, minute: Number(e.target.value) })}
                  className="w-20 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                />
              </div>
              <div className="flex gap-2">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-9 h-9 rounded-lg text-xs font-medium transition-all ${
                      trigger.days.includes(day) ? 'bg-accent-orange text-white' : 'bg-bg-primary text-text-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">Aucun jour sélectionné = tous les jours</p>
            </div>
          )}

          {trigger.type === 'sun' && (
            <div className="flex gap-3 items-center">
              <select
                value={trigger.event}
                onChange={(e) => setTrigger({ ...trigger, event: e.target.value as 'sunrise' | 'sunset' })}
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="sunrise">Lever du soleil</option>
                <option value="sunset">Coucher du soleil</option>
              </select>
              <input
                type="number"
                value={trigger.offsetMinutes}
                onChange={(e) => setTrigger({ ...trigger, offsetMinutes: Number(e.target.value) })}
                className="w-24 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
              />
              <span className="text-xs text-text-secondary">minutes (négatif = avant)</span>
            </div>
          )}

          {trigger.type === 'sensor' && (
            <div className="flex gap-3">
              <input
                type="text"
                value={trigger.sensorId}
                onChange={(e) => setTrigger({ ...trigger, sensorId: e.target.value })}
                placeholder="ID du capteur"
                className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
              />
              <select
                value={trigger.event}
                onChange={(e) => setTrigger({ ...trigger, event: e.target.value as SensorEvent })}
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="motion">Mouvement détecté</option>
                <option value="no_motion">Plus de mouvement</option>
                <option value="button_press">Bouton pressé</option>
                <option value="low_light">Faible luminosité</option>
                <option value="bright_light">Forte luminosité</option>
              </select>
            </div>
          )}

          {trigger.type === 'light_state' && (
            <div className="flex gap-3">
              <select
                value={trigger.targetKind}
                onChange={(e) => setTrigger({ ...trigger, targetKind: e.target.value as 'light' | 'group' })}
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="light">Lampe</option>
                <option value="group">Groupe</option>
              </select>
              <select
                value={trigger.targetId}
                onChange={(e) => setTrigger({ ...trigger, targetId: e.target.value })}
                className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="">Choisir...</option>
                {(trigger.targetKind === 'light' ? lights : groups).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                value={trigger.state}
                onChange={(e) => setTrigger({ ...trigger, state: e.target.value as 'on' | 'off' })}
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="on">S'allume</option>
                <option value="off">S'éteint</option>
              </select>
            </div>
          )}
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Conditions (optionnel)</h2>
            <button
              type="button"
              onClick={() => setConditions([...conditions, defaultCondition()])}
              className="flex items-center gap-1 text-xs text-accent-orange hover:underline"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
          {conditions.map((condition, index) => (
            <div key={index} className="flex items-center gap-3">
              <select
                value={condition.type}
                onChange={(e) => {
                  const type = e.target.value as Condition['type']
                  const next = [...conditions]
                  if (type === 'time_window') next[index] = { type: 'time_window', after: { hour: 20, minute: 0 } }
                  else if (type === 'light_state')
                    next[index] = { type: 'light_state', targetId: '', targetKind: 'light', state: 'on' }
                  else next[index] = { type: 'sensor_state', sensorId: '', state: 'motion' }
                  setConditions(next)
                }}
                className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="time_window">Fenêtre horaire</option>
                <option value="light_state">État lampe/groupe</option>
                <option value="sensor_state">État capteur</option>
              </select>

              {condition.type === 'time_window' && (
                <>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={condition.after?.hour ?? 0}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = {
                        ...condition,
                        after: { hour: Number(e.target.value), minute: condition.after?.minute ?? 0 },
                      }
                      setConditions(next)
                    }}
                    className="w-16 bg-bg-primary border border-white/10 rounded-xl px-2 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  />
                  <span className="text-xs text-text-secondary">à</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={condition.before?.hour ?? 23}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = {
                        ...condition,
                        before: { hour: Number(e.target.value), minute: condition.before?.minute ?? 59 },
                      }
                      setConditions(next)
                    }}
                    className="w-16 bg-bg-primary border border-white/10 rounded-xl px-2 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  />
                </>
              )}

              {condition.type === 'light_state' && (
                <>
                  <select
                    value={condition.targetKind}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = { ...condition, targetKind: e.target.value as 'light' | 'group' }
                      setConditions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="light">Lampe</option>
                    <option value="group">Groupe</option>
                  </select>
                  <select
                    value={condition.targetId}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = { ...condition, targetId: e.target.value }
                      setConditions(next)
                    }}
                    className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="">Choisir...</option>
                    {(condition.targetKind === 'light' ? lights : groups).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={condition.state}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = { ...condition, state: e.target.value as 'on' | 'off' }
                      setConditions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="on">Allumée</option>
                    <option value="off">Éteinte</option>
                  </select>
                </>
              )}

              {condition.type === 'sensor_state' && (
                <>
                  <input
                    type="text"
                    value={condition.sensorId}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = { ...condition, sensorId: e.target.value }
                      setConditions(next)
                    }}
                    placeholder="ID du capteur"
                    className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                  />
                  <select
                    value={condition.state}
                    onChange={(e) => {
                      const next = [...conditions]
                      next[index] = { ...condition, state: e.target.value as SensorEvent }
                      setConditions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="motion">Mouvement</option>
                    <option value="no_motion">Pas de mouvement</option>
                    <option value="low_light">Faible luminosité</option>
                    <option value="bright_light">Forte luminosité</option>
                  </select>
                </>
              )}

              <button
                type="button"
                onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                className="text-text-secondary hover:text-red-400 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Actions</h2>
            <button
              type="button"
              onClick={() => setActions([...actions, defaultAction()])}
              className="flex items-center gap-1 text-xs text-accent-orange hover:underline"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
          {actions.map((action, index) => (
            <div key={index} className="flex items-center gap-3">
              <select
                value={action.type}
                onChange={(e) => {
                  const type = e.target.value as Action['type']
                  const next = [...actions]
                  next[index] =
                    type === 'set_light_state'
                      ? { type: 'set_light_state', targetId: '', targetKind: 'light', update: { on: true } }
                      : { type: 'activate_scene', groupId: '', sceneId: '' }
                  setActions(next)
                }}
                className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="set_light_state">Régler une lampe/groupe</option>
                <option value="activate_scene">Activer une scène</option>
              </select>

              {action.type === 'set_light_state' && (
                <>
                  <select
                    value={action.targetKind}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = { ...action, targetKind: e.target.value as 'light' | 'group' }
                      setActions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="light">Lampe</option>
                    <option value="group">Groupe</option>
                  </select>
                  <select
                    value={action.targetId}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = { ...action, targetId: e.target.value }
                      setActions(next)
                    }}
                    className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="">Choisir...</option>
                    {(action.targetKind === 'light' ? lights : groups).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={action.update.on === false ? 'off' : 'on'}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = { ...action, update: { ...action.update, on: e.target.value === 'on' } }
                      setActions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="on">Allumer</option>
                    <option value="off">Éteindre</option>
                  </select>
                </>
              )}

              {action.type === 'activate_scene' && (
                <select
                  value={action.sceneId}
                  onChange={(e) => {
                    const scene = scenes.find((s) => s.id === e.target.value)
                    const next = [...actions]
                    next[index] = { type: 'activate_scene', groupId: scene?.group ?? '', sceneId: e.target.value }
                    setActions(next)
                  }}
                  className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                >
                  <option value="">Choisir une scène...</option>
                  {scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setActions(actions.filter((_, i) => i !== index))}
                className="text-text-secondary hover:text-red-400 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>

        <div className="flex items-center gap-3 pb-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Activée
          </label>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the routes**

In `src/App.tsx`, the current relevant lines are:

```tsx
import Rooms from './pages/Rooms'
import RoomDetail from './pages/RoomDetail'
```
and
```tsx
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/rooms/:id" element={<RoomDetail />} />
```

Change them to:

```tsx
import Rooms from './pages/Rooms'
import RoomDetail from './pages/RoomDetail'
import AutomationForm from './pages/AutomationForm'
```
and
```tsx
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/rooms/:id" element={<RoomDetail />} />
          <Route path="/routines/new" element={<AutomationForm />} />
          <Route path="/routines/:id" element={<AutomationForm />} />
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, navigate to `/routines`, click "Nouvelle automatisation". Expected: the form loads, switching the "Déclencheur" select swaps the visible fields (heure fixe ↔ lever/coucher ↔ capteur ↔ état lampe), and the lampe/groupe/scène dropdowns in conditions/actions are populated from your real Hue data via `useHue()`. Saving without `automation-engine` running shows the red error message (expected — backend not deployed yet).

- [ ] **Step 5: Commit**

```bash
git add src/pages/AutomationForm.tsx src/App.tsx
git commit -m "Add automation create/edit form"
```

## Task 12: Deployment — second container, nginx proxy, build script

**Files:**
- Create: `automation-engine/Dockerfile`
- Modify: `docker-compose.yml` (full replacement)
- Modify: `nginx.conf.template` (add one `location` block)
- Modify: `build-docker.sh` (full replacement)

**Interfaces:**
- Consumes: nothing — this is the deployment wiring for everything built in Tasks 1–11.
- Produces: nothing — terminal task.

- [ ] **Step 1: Write the automation-engine Dockerfile**

`automation-engine/Dockerfile`:

```dockerfile
# Stage 1 — Installation des dependances
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2 — Build TypeScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3 — Image de production (dependances de prod uniquement)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Add the automation-engine service to docker-compose.yml**

Replace `docker-compose.yml` entirely:

```yaml
version: '3.9'

services:
  hue-dashboard:
    image: hue-dashboard:latest
    container_name: hue-dashboard-container
    restart: unless-stopped
    # ports:
    #   - "8042:80"       # Décommente pour accès local direct (sans tunnel)
    environment:
      - HUE_BRIDGE_IP=192.168.1.75
    networks:
      - hue-dashboard-default
      - voxurba-network # Reseau partage avec cloudflared (tunnel Cloudflare)

  automation-engine:
    image: automation-engine:latest
    container_name: automation-engine-container
    restart: unless-stopped
    environment:
      - HUE_BRIDGE_IP=192.168.1.75
      - HUE_USERNAME=${HUE_USERNAME}
    volumes:
      - automation-data:/data
    networks:
      - hue-dashboard-default # reseau interne uniquement, pas de sortie publique

networks:
  hue-dashboard-default:
  voxurba-network:
    external: true # Reseau partage gere existant sur le NAS (contient cloudflared)

volumes:
  automation-data:
```

`HUE_USERNAME` is interpolated by Docker Compose from a `.env` file next to `docker-compose.yml` on the NAS — written by `build-docker.sh` in Step 4 below.

- [ ] **Step 3: Add the automations-api proxy block to nginx**

In `nginx.conf.template`, the current relevant block is:

```nginx
    # Proxy vers le bridge Hue (réseau local, inaccessible depuis le navigateur externe)
    # ${HUE_BRIDGE_IP} est injecté par envsubst au démarrage du container
    location /hue-bridge/ {
        proxy_pass http://${HUE_BRIDGE_IP}/;
        proxy_set_header Host ${HUE_BRIDGE_IP};
    }
```

Add a new block right after it, inside the same `server { ... }`:

```nginx
    # Proxy vers automation-engine (nom de service Docker, resolu par le reseau interne du compose)
    location /automations-api/ {
        proxy_pass http://automation-engine:3001/;
    }
```

- [ ] **Step 4: Update the build/deploy script for two images**

Replace `build-docker.sh` entirely:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Configuration — a ajuster selon l'environnement
# ============================================================
NAS_USER="Alexis"
NAS_HOST="gargantua.local"        # IP ou hostname du NAS
NAS_DIR="/volume1/docker/hue-dashboard"
PLATFORM="linux/amd64"            # Architecture du NAS (Intel/AMD)

# ============================================================
# Verifications prealables
# ============================================================
if [ ! -f "Dockerfile" ]; then
  echo "Dockerfile introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

if [ ! -f "automation-engine/Dockerfile" ]; then
  echo "automation-engine/Dockerfile introuvable."
  exit 1
fi

echo "Build & Deploy — hue-dashboard + automation-engine"
echo "Cible : $NAS_USER@$NAS_HOST:$NAS_DIR"

# Charge les variables du fichier .env.local si present
if [ -f ".env.local" ]; then
  set -a; source .env.local; set +a
fi

# ============================================================
# [1/6] Build de l'image du dashboard
# ============================================================
echo "[1/6] Build de l'image hue-dashboard pour $PLATFORM..."
docker buildx build \
  --platform "$PLATFORM" \
  --build-arg "VITE_HUE_USERNAME=${VITE_HUE_USERNAME:-}" \
  --output "type=docker,dest=/tmp/hue-dashboard.tar" \
  --tag "hue-dashboard:latest" \
  .

# ============================================================
# [2/6] Build de l'image du moteur d'automatisations
# ============================================================
echo "[2/6] Build de l'image automation-engine pour $PLATFORM..."
docker buildx build \
  --platform "$PLATFORM" \
  --output "type=docker,dest=/tmp/automation-engine.tar" \
  --tag "automation-engine:latest" \
  ./automation-engine

# ============================================================
# [3/6] Compression
# ============================================================
echo "[3/6] Compression des images..."
gzip -f /tmp/hue-dashboard.tar
gzip -f /tmp/automation-engine.tar

# ============================================================
# [4/6] Preparation du dossier et copie de la config sur le NAS
# ============================================================
echo "[4/6] Preparation du dossier sur le NAS..."
ssh "$NAS_USER@$NAS_HOST" "mkdir -p $NAS_DIR"

# ssh stdin/stdout car le sous-systeme SFTP Synology est incompatible avec scp
echo "       Copie de docker-compose.yml..."
ssh "$NAS_USER@$NAS_HOST" "cat > $NAS_DIR/docker-compose.yml" < docker-compose.yml

echo "       Copie de .env (HUE_USERNAME pour automation-engine)..."
echo "HUE_USERNAME=${VITE_HUE_USERNAME:-}" | ssh "$NAS_USER@$NAS_HOST" "cat > $NAS_DIR/.env"

# ============================================================
# [5/6] Transfert des images
# ============================================================
echo "[5/6] Transfert des images vers le NAS..."
ssh "$NAS_USER@$NAS_HOST" "cat > /tmp/hue-dashboard.tar.gz" < /tmp/hue-dashboard.tar.gz
ssh "$NAS_USER@$NAS_HOST" "cat > /tmp/automation-engine.tar.gz" < /tmp/automation-engine.tar.gz

# ============================================================
# [6/6] Chargement et redemarrage sur le NAS
# ============================================================
echo "[6/6] Chargement des images et redemarrage des containers..."
ssh "$NAS_USER@$NAS_HOST" "
  export PATH=/usr/local/bin:/usr/bin:/bin:\$PATH
  set -e
  sudo docker load < /tmp/hue-dashboard.tar.gz
  sudo docker load < /tmp/automation-engine.tar.gz
  rm /tmp/hue-dashboard.tar.gz /tmp/automation-engine.tar.gz
  cd ${NAS_DIR}
  sudo docker compose down --remove-orphans
  sudo docker compose up -d
  sudo docker ps --filter name=hue-dashboard --filter name=automation-engine
"

# ============================================================
# Nettoyage local
# ============================================================
rm -f /tmp/hue-dashboard.tar.gz /tmp/automation-engine.tar.gz

echo ""
echo "Deploiement termine !"
echo "App disponible sur : http://$NAS_HOST:8042"
```

- [ ] **Step 5: Verify the automation-engine image builds**

Run: `docker build -t automation-engine:latest ./automation-engine`
Expected: the build completes successfully through all three stages, ending with `naming to docker.io/library/automation-engine:latest`.

- [ ] **Step 6: [MANUAL — needs NAS access] Deploy and verify end-to-end**

Run yourself, from the project root, with `VITE_HUE_USERNAME` set in `.env.local` as already required by the existing dashboard deploy:

```bash
./build-docker.sh
```
Expected: both images build, transfer, and start on the NAS; `docker ps` on the NAS shows both `hue-dashboard-container` and `automation-engine-container` as `Up`. Then, from a browser on the dashboard, go to Settings, set your real latitude/longitude, save, go to Automatisations, create a `time` automation a couple of minutes in the future targeting a real light, and confirm the light actually changes state when that time hits — the full loop from the deployed containers back to a physical bulb.

- [ ] **Step 7: Commit**

```bash
git add automation-engine/Dockerfile docker-compose.yml nginx.conf.template build-docker.sh
git commit -m "Deploy automation-engine as a second container with nginx proxy"
```

---

## Self-Review

**Spec coverage:** every section of `docs/superpowers/specs/2026-07-17-automatisations-design.md` maps to a task — Architecture/data model → Tasks 1–2, hybrid scheduler+eventstream → Tasks 6–7, API → Task 2, Frontend → Tasks 8–11, Déploiement → Task 12, Gestion d'erreurs → Task 5's try/catch (verified in Task 5 Step 4) and Task 7's reconnect loop, Tests → Task 3 is the only Vitest suite, matching the spec's explicit scope decision.

**Placeholder scan:** no TBD/TODO markers; every code block is complete and runnable. Two issues were caught and fixed while writing this plan (not left as placeholders): the scheduler originally skipped `time` triggers entirely when no location was configured (fixed — only `sun` triggers are affected by missing config); `runTick` originally let a bridge-unreachable error during snapshot fetch propagate uncaught (fixed — wrapped in try/catch, verified in Task 5 Step 4); the eventstream listener originally disabled TLS verification outright (fixed — replaced with trust-on-first-use certificate pinning).

**Type consistency:** `Automation`, `Trigger`, `Condition`, `Action`, `AutomationRunLogEntry`, `LocationConfig` are defined once in Task 1 (backend) and mirrored once in Task 8 (frontend) — every later task imports rather than redefines. `AutomationStore` method names (`list`, `get`, `create`, `update`, `remove`, `toggle`, `getHistory`, `appendHistory`, `getConfig`, `setConfig`) are identical between their Task 2 definition and every call site in Tasks 5, 6, 7, 12. `runTick`'s signature (`store, client, ctx, snapshot?`) is identical between its Task 5 definition and its Task 6/7 call sites.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-automatisations-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

