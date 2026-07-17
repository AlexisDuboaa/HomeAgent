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
