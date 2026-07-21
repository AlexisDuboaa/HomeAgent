import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { randomUUID } from 'node:crypto'
import type { Automation, AutomationRunLogEntry, AutomationsStoreData, LocationConfig } from './types.js'

const DEFAULT_DATA: AutomationsStoreData = { automations: [], history: {}, config: null, suppressions: {} }
const MAX_HISTORY_ENTRIES = 20

export class AutomationStore {
  private db: Low<AutomationsStoreData>

  constructor(filePath: string) {
    this.db = new Low<AutomationsStoreData>(new JSONFile(filePath), DEFAULT_DATA)
  }

  async init(): Promise<void> {
    await this.db.read()
    this.db.data ||= DEFAULT_DATA
    // db.read() replaces this.db.data wholesale with whatever was parsed from
    // disk — it does not merge with DEFAULT_DATA. A data file written before a
    // collection existed (e.g. `suppressions`, added for the "respect manual
    // off" feature) will be missing that key even though `this.db.data` itself
    // is truthy. Backfill defensively so older files are safe to load.
    this.db.data.automations ??= []
    this.db.data.history ??= {}
    this.db.data.config ??= null
    this.db.data.suppressions ??= {}
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
    for (const key of Object.keys(this.db.data.suppressions)) {
      if (key.startsWith(`${id}:`)) delete this.db.data.suppressions[key]
    }
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

  getSuppressions(): Record<string, { until: string }> {
    return this.db.data.suppressions
  }

  async setSuppression(key: string, until: string): Promise<void> {
    this.db.data.suppressions[key] = { until }
    await this.db.write()
  }
}
