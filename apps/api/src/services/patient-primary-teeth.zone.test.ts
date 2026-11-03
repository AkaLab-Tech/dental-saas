import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Task #658. Each guard runs the real helper in a CHILD PROCESS started with TZ set in its
// environment and the clock fixed there. Pinning the host zone in-process (vi.stubEnv) is not
// reliable in this suite: env.test.ts and email.service.test.ts replace process.env with a
// plain object, after which assigning TZ no longer reaches the runtime, so the guards failed
// depending on file order. The driver asserts the pin before calling the helper.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'

// Calendar day stored at UTC midnight: the patient turns 12 on 2026-11-04.
const DOB = '2014-11-04T00:00:00.000Z'

const here = dirname(fileURLToPath(import.meta.url))
const driver = resolve(here, 'patient-primary-teeth.zone.child.ts')
const tsx = resolve(here, '../../node_modules/.bin/tsx')

function underAge(host: string, tenant: string, now: string): boolean {
  const out = spawnSync(tsx, [driver, host, tenant, now, DOB], {
    env: { ...process.env, TZ: host },
    encoding: 'utf8',
  })
  expect(out.status, `driver failed: ${out.stderr}`).toBe(0)
  return JSON.parse(out.stdout.trim().split('\n').pop() as string).result
}

describe('isUnderPrimaryTeethAge by calendar day in the tenant zone (#658)', () => {
  it('G1: host MVD, tenant MVD, 12:00 local the day before the birthday -> true', () => {
    expect(underAge(MONTEVIDEO, MONTEVIDEO, '2026-11-03T15:00:00.000Z')).toBe(true)
  })

  it('G2: host UTC, tenant MVD, 22:00 on 3 Nov in Montevideo (4 Nov in UTC) -> true', () => {
    expect(underAge(UTC, MONTEVIDEO, '2026-11-04T01:00:00.000Z')).toBe(true)
  })

  it('G3: host MVD, tenant MVD, same residual instant as G2 -> true', () => {
    expect(underAge(MONTEVIDEO, MONTEVIDEO, '2026-11-04T01:00:00.000Z')).toBe(true)
  })

  it.each([MONTEVIDEO, UTC])('G4: host %s, tenant MVD, day after the birthday -> false (vacuity)', (host) => {
    expect(underAge(host, MONTEVIDEO, '2026-11-05T15:00:00.000Z')).toBe(false)
  })

  it('G5: host MVD, tenant UTC, instant that is already 4 Nov in UTC -> false (reads its argument)', () => {
    expect(underAge(MONTEVIDEO, UTC, '2026-11-04T01:00:00.000Z')).toBe(false)
  })

  it('G6: host MVD, tenant MVD, the birthday itself -> false (strict age < 12)', () => {
    expect(underAge(MONTEVIDEO, MONTEVIDEO, '2026-11-04T15:00:00.000Z')).toBe(false)
  })
})
