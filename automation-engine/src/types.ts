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
