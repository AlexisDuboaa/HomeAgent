import { describe, expect, it } from 'vitest'
import suncalc from 'suncalc'
import { isSuppressed, nextSunrise, suppressionKey } from '../src/suppression.js'

const PARIS_LAT = 48.8566
const PARIS_LON = 2.3522

describe('suppressionKey', () => {
  it('joins automationId and targetId with a colon', () => {
    expect(suppressionKey('a1', '5')).toBe('a1:5')
  })
})

describe('isSuppressed', () => {
  it('returns false when there is no entry for the key', () => {
    expect(isSuppressed({}, 'a1', '5', new Date())).toBe(false)
  })

  it('returns true when the suppression is still in the future', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() + 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '5', new Date())).toBe(true)
  })

  it('returns false when the suppression has already expired', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() - 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '5', new Date())).toBe(false)
  })

  it('is scoped to the exact automationId/targetId pair', () => {
    const suppressions = { 'a1:5': { until: new Date(Date.now() + 60_000).toISOString() } }
    expect(isSuppressed(suppressions, 'a1', '6', new Date())).toBe(false)
    expect(isSuppressed(suppressions, 'a2', '5', new Date())).toBe(false)
  })
})

describe('nextSunrise', () => {
  it('returns today\'s sunrise when now is before it', () => {
    const now = new Date('2026-01-01T05:00:00Z') // 5 AM UTC, avant le lever du soleil (7:45 AM)
    const expected = suncalc.getTimes(now, PARIS_LAT, PARIS_LON).sunrise
    expect(nextSunrise(now, PARIS_LAT, PARIS_LON)).toEqual(expected)
  })

  it('returns tomorrow\'s sunrise when now is after today\'s', () => {
    const now = new Date('2026-01-01T10:00:00Z') // 10 AM UTC, après le lever du soleil (7:45 AM)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const expected = suncalc.getTimes(tomorrow, PARIS_LAT, PARIS_LON).sunrise
    expect(nextSunrise(now, PARIS_LAT, PARIS_LON)).toEqual(expected)
  })
})
