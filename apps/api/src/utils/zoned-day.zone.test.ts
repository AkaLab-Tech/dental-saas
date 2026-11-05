import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Task #654. Each guard runs the real helpers in a CHILD PROCESS started with TZ set in its
// environment and the clock fixed there. Pinning the host zone in-process (vi.stubEnv) is not
// reliable in this suite: env.test.ts and email.service.test.ts replace process.env with a
// plain object, after which assigning TZ no longer reaches the runtime. The driver asserts the
// pin (resolved host zone) before calling the helper.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'
const TOKYO = 'Asia/Tokyo'
const SANTIAGO = 'America/Santiago'

const here = dirname(fileURLToPath(import.meta.url))
const driver = resolve(here, 'zoned-day.zone.child.ts')
const tsx = resolve(here, '../../node_modules/.bin/tsx')

type Mode = 'day' | 'monthkey' | 'range' | 'dayrange' | 'weekrange'
type Range = { start: string; end: string }

function run(
  host: string,
  tenant: string,
  mode: Mode,
  instant: string,
  monthOffset?: number
): unknown {
  const argv = [driver, host, tenant, mode, instant]
  if (monthOffset !== undefined) argv.push(String(monthOffset))
  const out = spawnSync(tsx, argv, {
    env: { ...process.env, TZ: host },
    encoding: 'utf8',
  })
  expect(out.status, `driver failed: ${out.stderr}`).toBe(0)
  return JSON.parse(out.stdout.trim().split('\n').pop() as string).result
}

const dayKey = (host: string, tenant: string, instant: string) => run(host, tenant, 'day', instant)
const range = (host: string, tenant: string, now: string, monthOffset?: number) =>
  run(host, tenant, 'range', now, monthOffset) as Range
const monthKey = (host: string, tenant: string, instant: string) =>
  run(host, tenant, 'monthkey', instant)
const dayRange = (host: string, tenant: string, now: string) =>
  run(host, tenant, 'dayrange', now) as Range
const weekRange = (host: string, tenant: string, now: string) =>
  run(host, tenant, 'weekrange', now) as Range

// 28 Oct 21:00 in Montevideo (UTC-3), already 29 Oct in UTC.
const MVD_2100 = '2026-10-29T00:00:00.000Z'

describe('zonedDayKey / zonedMonthRange read the tenant zone, not the host (#654)', () => {
  it('G1: host UTC, tenant MVD, 21:00 local -> previous UTC day key', () => {
    expect(dayKey(UTC, MONTEVIDEO, MVD_2100)).toBe('2026-10-28')
  })

  it('G2: host MVD, tenant MVD, same instant -> same key (host zone does not move it)', () => {
    expect(dayKey(MONTEVIDEO, MONTEVIDEO, MVD_2100)).toBe('2026-10-28')
  })

  it('G3: host MVD, tenant UTC, same instant -> 2026-10-29 (tenant zone moves it)', () => {
    expect(dayKey(MONTEVIDEO, UTC, MVD_2100)).toBe('2026-10-29')
  })

  it('G4: host UTC, tenant Tokyo, 08:00 local on 28 Oct (23:00Z on 27 Oct) -> 2026-10-28', () => {
    expect(dayKey(UTC, TOKYO, '2026-10-27T23:00:00.000Z')).toBe('2026-10-28')
  })

  it('G5: host UTC, tenant MVD, October window instants', () => {
    expect(range(UTC, MONTEVIDEO, '2026-10-15T12:00:00.000Z')).toEqual({
      start: '2026-10-01T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
  })

  it('G6: host MVD, tenant MVD, same now -> identical range as G5', () => {
    expect(range(MONTEVIDEO, MONTEVIDEO, '2026-10-15T12:00:00.000Z')).toEqual(
      range(UTC, MONTEVIDEO, '2026-10-15T12:00:00.000Z')
    )
    expect(range(MONTEVIDEO, MONTEVIDEO, '2026-10-15T12:00:00.000Z')).toEqual({
      start: '2026-10-01T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
  })

  it.each([
    ['2026-09-15T12:00:00.000Z', '2026-09-01T04:00:00.000Z'],
    ['2026-12-15T12:00:00.000Z', '2026-12-01T03:00:00.000Z'],
  ])('G7: tenant Santiago (DST), now %s -> month start %s', (now, expectedStart) => {
    const r = range(UTC, SANTIAGO, now) as { start: string; end: string }
    expect(r.start).toBe(expectedStart)
  })
})

// Task #661, G11-G20. Same child-process technique as G1-G7 above, extended to the helpers the
// stats/appointment aggregates now use. All ten are new-code-only (zonedMonthKey, the
// `monthOffset` argument, zonedDayRange and zonedWeekRange do not exist before the fix) except
// G15, which is byte-identical to G5 and exists so that adding `monthOffset` cannot silently
// move the shipped answer.
//
// The ranges are returned CLOSED (`end` is the last instant of the window, i.e. the next
// window's start minus 1ms), so a half-open `[a, b)` in the plan is asserted as
// `{ start: a, end: b - 1ms }`.
describe('zonedMonthKey / monthOffset / zonedDayRange / zonedWeekRange read the tenant zone (#661)', () => {
  // 22:00 on 31 Oct in Montevideo (UTC-3), already 1 Nov in UTC. 31 Oct 2026 is a Saturday.
  const MVD_2200_31_OCT = '2026-11-01T01:00:00.000Z'

  it('G11: host UTC, tenant MVD, 22:00 local on 31 Oct -> month key 2026-10', () => {
    expect(monthKey(UTC, MONTEVIDEO, MVD_2200_31_OCT)).toBe('2026-10')
  })

  it('G12: host MVD, tenant UTC, same instant -> 2026-11 (the tenant zone moves the key)', () => {
    expect(monthKey(MONTEVIDEO, UTC, MVD_2200_31_OCT)).toBe('2026-11')
  })

  it('G13: host UTC, tenant Tokyo, 01:00 local on 1 Nov (16:00Z 31 Oct) -> 2026-11', () => {
    expect(monthKey(UTC, TOKYO, '2026-10-31T16:00:00.000Z')).toBe('2026-11')
  })

  it('G14: tenant MVD, now 15 Nov, monthOffset -1 -> the October window', () => {
    expect(range(UTC, MONTEVIDEO, '2026-11-15T12:00:00.000Z', -1)).toEqual({
      start: '2026-10-01T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
  })

  it('G15: tenant MVD, now 15 Oct, monthOffset 0 -> identical to G5 (no silent move)', () => {
    expect(range(UTC, MONTEVIDEO, '2026-10-15T12:00:00.000Z', 0)).toEqual({
      start: '2026-10-01T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
  })

  it('G16: tenant Santiago, now 15 Oct: offsets 0 and -1 start at DIFFERENT UTC offsets', () => {
    const now = '2026-10-15T12:00:00.000Z'
    expect(range(UTC, SANTIAGO, now, 0).start).toBe('2026-10-01T03:00:00.000Z')
    expect(range(UTC, SANTIAGO, now, -1).start).toBe('2026-09-01T04:00:00.000Z')
  })

  it('G17: tenant MVD, now 10 Jan 2027, monthOffset -1 -> December 2026 (year rollover)', () => {
    expect(range(UTC, MONTEVIDEO, '2027-01-10T12:00:00.000Z', -1)).toEqual({
      start: '2026-12-01T03:00:00.000Z',
      end: '2027-01-01T02:59:59.999Z',
    })
  })

  it('G18: zonedDayRange, 22:00 local 31 Oct: MVD gives the 31st, UTC the 1st', () => {
    expect(dayRange(UTC, MONTEVIDEO, MVD_2200_31_OCT)).toEqual({
      start: '2026-10-31T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
    expect(dayRange(UTC, UTC, MVD_2200_31_OCT)).toEqual({
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-01T23:59:59.999Z',
    })
  })

  it('G19: zonedWeekRange, same instant: MVD gives Sun 25 - Sat 31 Oct, UTC the week of 1 Nov', () => {
    expect(weekRange(UTC, MONTEVIDEO, MVD_2200_31_OCT)).toEqual({
      start: '2026-10-25T03:00:00.000Z',
      end: '2026-11-01T02:59:59.999Z',
    })
    expect(weekRange(UTC, UTC, MVD_2200_31_OCT)).toEqual({
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-07T23:59:59.999Z',
    })
  })

  it('G20: zonedWeekRange, tenant Santiago, week starting on a local midnight that does not exist', () => {
    // 6 Sep 2026 is Santiago's spring-forward day: 00:00 local never happens. Per the rule
    // written down at dayStartInstant, the window begins at the first instant that does (01:00
    // local = 03:00Z), not at 23:00Z on the 5th.
    expect(weekRange(UTC, SANTIAGO, '2026-09-09T12:00:00.000Z')).toEqual({
      start: '2026-09-06T03:00:00.000Z',
      end: '2026-09-13T02:59:59.999Z',
    })
  })
})
