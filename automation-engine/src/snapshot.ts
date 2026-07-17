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
