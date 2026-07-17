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
