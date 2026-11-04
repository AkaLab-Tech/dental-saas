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

function run(host: string, tenant: string, mode: 'day' | 'range', instant: string): unknown {
  const out = spawnSync(tsx, [driver, host, tenant, mode, instant], {
    env: { ...process.env, TZ: host },
    encoding: 'utf8',
  })
  expect(out.status, `driver failed: ${out.stderr}`).toBe(0)
  return JSON.parse(out.stdout.trim().split('\n').pop() as string).result
}

const dayKey = (host: string, tenant: string, instant: string) => run(host, tenant, 'day', instant)
const range = (host: string, tenant: string, now: string) => run(host, tenant, 'range', now)

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
