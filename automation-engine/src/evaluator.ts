import type {
  Action,
  Automation,
  BridgeStateSnapshot,
  Condition,
  EvaluationContext,
  Trigger,
} from './types.js'

// Échelle log Hue : lightlevel = 10000·log10(lux) + 1. Math.max(lux, 1) évite log10(0).
export function luxToLightlevel(lux: number): number {
  return Math.round(10000 * Math.log10(Math.max(lux, 1)) + 1)
}

function matchesLightLevelThreshold(
  event: 'low_light' | 'bright_light',
  threshold: number,
  lightlevel: number | undefined
): boolean {
  if (lightlevel === undefined) return false
  const thresholdRaw = luxToLightlevel(threshold)
  return event === 'low_light' ? lightlevel < thresholdRaw : lightlevel > thresholdRaw
}

export function matchesTrigger(
  trigger: Trigger,
  ctx: EvaluationContext,
  snapshot: BridgeStateSnapshot
): boolean {
  if (trigger.type === 'time') {
    const dayMatches = trigger.days.length === 0 || trigger.days.includes(ctx.now.getDay())
    return (
      dayMatches && trigger.hour === ctx.now.getHours() && trigger.minute === ctx.now.getMinutes()
    )
  }
  if (trigger.type === 'sun') {
    const base = trigger.event === 'sunrise' ? ctx.sunTimes.sunrise : ctx.sunTimes.sunset
    const target = new Date(base.getTime() + trigger.offsetMinutes * 60_000)
    return isSameMinute(ctx.now, target)
  }
  if (trigger.type === 'sensor') {
    if (ctx.event?.kind !== 'sensor' || ctx.event.sensorId !== trigger.sensorId) return false
    if (
      trigger.threshold !== undefined &&
      (trigger.event === 'low_light' || trigger.event === 'bright_light')
    ) {
      return matchesLightLevelThreshold(
        trigger.event,
        trigger.threshold,
        snapshot.sensors[trigger.sensorId]?.lightlevel
      )
    }
    return ctx.event.event === trigger.event
  }
  // trigger.type === 'light_state'
  return (
    ctx.event?.kind === 'light_state' &&
    ctx.event.targetId === trigger.targetId &&
    ctx.event.targetKind === trigger.targetKind &&
    ctx.event.state === trigger.state
  )
}

export function checkConditions(
  conditions: Condition[],
  snapshot: BridgeStateSnapshot,
  now: Date
): boolean {
  return conditions.every((condition) => checkCondition(condition, snapshot, now))
}

function checkCondition(condition: Condition, snapshot: BridgeStateSnapshot, now: Date): boolean {
  if (condition.type === 'time_window') {
    const minutes = now.getHours() * 60 + now.getMinutes()
    const afterMinutes = condition.after ? condition.after.hour * 60 + condition.after.minute : null
    const beforeMinutes = condition.before
      ? condition.before.hour * 60 + condition.before.minute
      : null
    if (afterMinutes !== null && minutes < afterMinutes) return false
    if (beforeMinutes !== null && minutes > beforeMinutes) return false
    return true
  }
  if (condition.type === 'light_state') {
    const target =
      condition.targetKind === 'light'
        ? snapshot.lights[condition.targetId]
        : snapshot.groups[condition.targetId]
    if (!target) return false
    return (target.on ? 'on' : 'off') === condition.state
  }
  // condition.type === 'sensor_state'
  const sensor = snapshot.sensors[condition.sensorId]
  if (!sensor) return false
  if (
    condition.threshold !== undefined &&
    (condition.state === 'low_light' || condition.state === 'bright_light')
  ) {
    return matchesLightLevelThreshold(condition.state, condition.threshold, sensor.lightlevel)
  }
  return sensor.state === condition.state
}

export function evaluate(
  automation: Automation,
  ctx: EvaluationContext,
  snapshot: BridgeStateSnapshot
): Action[] | null {
  if (!automation.enabled) return null
  if (!matchesTrigger(automation.trigger, ctx, snapshot)) return null
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
