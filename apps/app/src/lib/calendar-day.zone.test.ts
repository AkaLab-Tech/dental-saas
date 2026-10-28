import { describe, it, expect, afterEach, vi } from 'vitest'
import { formatCalendarDay, formatShortDate } from './format'
import { formatPaymentDate } from './payment-api'

// Task #651. The zone is PINNED per test with vi.stubEnv('TZ', ...), never
// inherited: no vitest config or script in this repo sets TZ, so an unpinned
// assertion passes in CI (UTC) and fails on a Montevideo machine.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'

// A calendar day is stored as UTC midnight of the day the user picked.
const CALENDAR_DAY = '2026-10-28T00:00:00.000Z'
// An instant that is 22:30 on 28 Oct in Montevideo (UTC-3) but 29 Oct in UTC.
const LATE_EVENING_INSTANT = '2026-10-29T01:30:00.000Z'

function inZone(zone: string, fn: () => void) {
  vi.stubEnv('TZ', zone)
  // Prove the pin took effect, so a silent no-op cannot make a case vacuous.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  fn()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('formatCalendarDay (#651)', () => {
  it.each([MONTEVIDEO, UTC])('returns the stored calendar day, 28 oct 2026, for a viewer in %s', (zone) => {
    inZone(zone, () => {
      expect(formatCalendarDay(CALENDAR_DAY, 'es')).toMatch(/^28 oct\.? 2026$/)
    })
  })

  it('honours caller options and still reads the value in UTC', () => {
    inZone(MONTEVIDEO, () => {
      expect(formatCalendarDay(CALENDAR_DAY, 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe(
        '10/28/2026'
      )
    })
  })
})

describe('formatShortDate is unchanged for an instant (#651)', () => {
  it('shows the viewer-local day in Montevideo (28 oct)', () => {
    inZone(MONTEVIDEO, () => {
      expect(formatShortDate(LATE_EVENING_INSTANT, 'es')).toMatch(/^28 oct\.? 2026$/)
    })
  })

  it('shows the UTC day in UTC (29 oct)', () => {
    inZone(UTC, () => {
      expect(formatShortDate(LATE_EVENING_INSTANT, 'es')).toMatch(/^29 oct\.? 2026$/)
    })
  })
})

describe('formatPaymentDate discriminates on appointmentId (#651)', () => {
  it.each([MONTEVIDEO, UTC])('hand-entered row (no appointmentId) keeps its calendar day in %s', (zone) => {
    inZone(zone, () => {
      expect(formatPaymentDate(CALENDAR_DAY, null, 'es')).toMatch(/^28 oct\.? 2026$/)
    })
  })

  it('appointment-origin row (21:00-24:00 Montevideo) does not roll forward to the next day', () => {
    inZone(MONTEVIDEO, () => {
      expect(formatPaymentDate(LATE_EVENING_INSTANT, 'appt-1', 'es')).toMatch(/^28 oct\.? 2026$/)
    })
  })

  it('appointment-origin row is rendered as an instant in UTC too (29 oct)', () => {
    inZone(UTC, () => {
      expect(formatPaymentDate(LATE_EVENING_INSTANT, 'appt-1', 'es')).toMatch(/^29 oct\.? 2026$/)
    })
  })
})
