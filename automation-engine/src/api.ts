import express from 'express'
import type { AutomationStore } from './store.js'
import type { Automation, LocationConfig } from './types.js'

const TRIGGER_TYPES = new Set(['time', 'sun', 'sensor', 'light_state'])

function isValidAutomationInput(body: unknown): body is Omit<Automation, 'id' | 'createdAt'> {
  if (typeof body !== 'object' || body === null) return false
  const input = body as Record<string, unknown>

  if (typeof input.name !== 'string' || input.name.trim().length === 0) return false
  if (typeof input.enabled !== 'boolean') return false
  if (typeof input.trigger !== 'object' || input.trigger === null) return false
  const trigger = input.trigger as Record<string, unknown>
  if (typeof trigger.type !== 'string' || !TRIGGER_TYPES.has(trigger.type)) return false
  if (!Array.isArray(input.conditions)) return false
  if (!Array.isArray(input.actions)) return false

  return true
}

function isValidLocationConfig(body: unknown): body is LocationConfig {
  if (typeof body !== 'object' || body === null) return false
  const config = body as Record<string, unknown>
  return (
    typeof config.latitude === 'number' &&
    Number.isFinite(config.latitude) &&
    typeof config.longitude === 'number' &&
    Number.isFinite(config.longitude)
  )
}

export function createApiServer(store: AutomationStore) {
  const app = express()
  app.use(express.json())

  app.get('/automations', (_req, res) => {
    res.json(store.list())
  })

  app.post('/automations', async (req, res) => {
    if (!isValidAutomationInput(req.body)) {
      res.status(400).json({ error: 'Automatisation invalide' })
      return
    }
    const automation = await store.create(req.body)
    res.status(201).json(automation)
  })

  app.put('/automations/:id', async (req, res) => {
    if (!isValidAutomationInput(req.body)) {
      res.status(400).json({ error: 'Automatisation invalide' })
      return
    }
    const automation = await store.update(req.params.id, req.body)
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
    if (!isValidLocationConfig(req.body)) {
      res.status(400).json({ error: 'Coordonnées invalides' })
      return
    }
    await store.setConfig(req.body)
    res.json(store.getConfig())
  })

  return app
}
