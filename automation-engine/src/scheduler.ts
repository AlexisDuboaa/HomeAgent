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
