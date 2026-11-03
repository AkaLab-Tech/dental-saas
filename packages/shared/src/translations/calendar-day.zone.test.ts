import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDate, formatCalendarDay } from './index.js'

// Task #653. The zone is PINNED per test with vi.stubEnv('TZ', ...), never
// inherited: no vitest config or script in this repo sets TZ, so an unpinned
// assertion passes in CI (UTC) and fails on a Montevideo machine.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'

// A calendar day is stored as UTC midnight of the day the user picked.
const CALENDAR_DAY = new Date('2026-10-28T00:00:00.000Z')
// An instant: 22:30 on 28 Oct in Montevideo (UTC-3), but 01:30 on 29 Oct in UTC.
const LATE_EVENING_INSTANT = new Date('2026-10-29T01:30:00.000Z')

function inZone(zone: string, fn: () => void) {
  vi.stubEnv('TZ', zone)
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  fn()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('formatDate with tenant timezone shifts calendar days west of UTC (#653 pre-fix defect)', () => {
  it('demonstrates that passing a tenant timezone west of UTC shifts the day', () => {
    // Pre-fix defect: the stored day 28 Oct renders as 27 Oct in the tenant's zone.
    const shifted = formatDate(CALENDAR_DAY, 'es', MONTEVIDEO, 'long')
    expect(shifted).toContain('27')
    expect(shifted).toContain('octubre')

    // Vacuity check, same call in UTC: the shift is the zone's doing.
    const unshifted = formatDate(CALENDAR_DAY, 'es', UTC, 'long')
    expect(unshifted).toContain('28')
    expect(unshifted).toContain('octubre')
  })

  it('keeps instant values formatted correctly according to the tenant timezone', () => {
    // An appointment at 22:30 on 28 Oct Montevideo time must show 28 Oct in Montevideo
    // and 29 Oct in UTC.
    const montevideoInstant = formatDate(LATE_EVENING_INSTANT, 'es', MONTEVIDEO, 'long')
    expect(montevideoInstant).toContain('28')

    const utcInstant = formatDate(LATE_EVENING_INSTANT, 'es', UTC, 'long')
    expect(utcInstant).toContain('29')
  })
})

describe('formatCalendarDay pins UTC (#653)', () => {
  it.each([MONTEVIDEO, UTC])('renders the stored calendar day (28 de octubre) in %s', (zone) => {
    inZone(zone, () => {
      const formattedLong = formatCalendarDay(CALENDAR_DAY, 'es', 'long')
      expect(formattedLong).toContain('28')
      expect(formattedLong).toContain('octubre')
      expect(formattedLong).toContain('2026')

      const formattedShort = formatCalendarDay(CALENDAR_DAY, 'es', 'short')
      expect(formattedShort).toContain('28')
      expect(formattedShort).toContain('2026')
    })
  })

  it.each([MONTEVIDEO, UTC])('supports English and Arabic locales without zone shift in %s', (zone) => {
    inZone(zone, () => {
      const enDate = formatCalendarDay(CALENDAR_DAY, 'en', 'long')
      expect(enDate).toContain('28')
      expect(enDate).toContain('October')

      const arDate = formatCalendarDay(CALENDAR_DAY, 'ar', 'long')
      expect(arDate).toContain('٢٨')
      expect(arDate).toContain('أكتوبر')
    })
  })
})
