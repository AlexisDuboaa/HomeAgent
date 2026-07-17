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

  const client = new HueClient({ bridgeIp: BRIDGE_IP!, username: USERNAME! })
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
