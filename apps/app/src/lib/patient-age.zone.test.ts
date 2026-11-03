import { describe, it, expect, afterEach, vi } from 'vitest'
import { calculateAge } from './patient-api'

// Task #655. The zone is PINNED per test with vi.stubEnv('TZ', ...) and the
// clock with vi.setSystemTime: no vitest config or script in this repo sets
// TZ, so an unpinned assertion measures the host.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'
const TOKYO = 'Asia/Tokyo'

// A calendar day is stored at UTC midnight, exactly what the API returns.
const DOB = '1984-05-12T00:00:00.000Z'

function inZone(zone: string, now: string, fn: () => void) {
  vi.stubEnv('TZ', zone)
  // Prove the pin took effect, so a silent no-op cannot make a case vacuous.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  fn()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('calculateAge, day before the birthday (#655)', () => {
  // [instant, expected in Montevideo, expected in UTC]
  it.each([
    ['2026-05-11T18:00:00Z', 41, 41], // 11 May 15:00 Montevideo
    ['2026-05-12T01:00:00Z', 41, 42], // 11 May 22:00 Montevideo, 12 May in UTC
    ['2026-05-12T13:00:00Z', 42, 42], // 12 May 10:00 Montevideo
  ])('at %s the age is %i in Montevideo and %i in UTC', (instant, montevideo, utc) => {
    inZone(MONTEVIDEO, instant, () => {
      expect(calculateAge(DOB)).toBe(montevideo)
    })
    vi.useRealTimers()
    inZone(UTC, instant, () => {
      expect(calculateAge(DOB)).toBe(utc)
    })
  })

  it('on the birthday itself the age has turned, in both zones', () => {
    inZone(MONTEVIDEO, '2026-05-12T03:00:00Z', () => {
      expect(calculateAge(DOB)).toBe(42) // 12 May 00:00 local
    })
    vi.useRealTimers()
    inZone(UTC, '2026-05-12T00:00:00Z', () => {
      expect(calculateAge(DOB)).toBe(42)
    })
  })
})

describe('calculateAge, newborn edge (#655, decision 4)', () => {
  it('a dob of today returns 0, not null, for a viewer east of UTC early in their day', () => {
    // 08:00 on 3 Nov in Tokyo. The dob instant (3 Nov 00:00Z) is still in the
    // viewer's future (2 Nov 23:00Z), which is what made the old code return null.
    const now = '2026-11-02T23:00:00Z'
    inZone(TOKYO, now, () => {
      expect(new Date('2026-11-03T00:00:00.000Z').getTime()).toBeGreaterThan(Date.now())
      expect(calculateAge('2026-11-03T00:00:00.000Z')).toBe(0)
    })
  })

  it('a dob of tomorrow is still null', () => {
    inZone(TOKYO, '2026-11-02T23:00:00Z', () => {
      expect(calculateAge('2026-11-04T00:00:00.000Z')).toBeNull()
    })
  })
})

describe('calculateAge, guards unchanged (#655)', () => {
  it('returns null for a missing dob', () => {
    inZone(MONTEVIDEO, '2026-05-12T01:00:00Z', () => {
      expect(calculateAge(null)).toBeNull()
      expect(calculateAge('')).toBeNull()
    })
  })

  it('returns null for an invalid dob', () => {
    inZone(MONTEVIDEO, '2026-05-12T01:00:00Z', () => {
      expect(calculateAge('not-a-date')).toBeNull()
    })
  })
})
