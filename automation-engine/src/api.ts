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
