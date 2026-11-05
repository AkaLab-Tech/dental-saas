/**
 * appointment.service — getAppointmentStats' today/week counters roll over at the TENANT's
 * midnight, not the server host's (task #661, G28-G30).
 *
 * DB-backed, in-process, host zone deliberately NOT pinned: each guard seeds two tenants with
 * different zones and asserts the two counters differ in a stated way. That is what makes them
 * fail on ANY host before the fix — the unfixed code derives today/week from the host's zone, so
 * both tenants necessarily get the same answer, whatever the host is.
 *
 * The clock is pinned with `vi.useFakeTimers({ toFake: ['Date'] })`; only Date is faked so the
 * database driver's timers keep running (patient.service.primary-teeth.test.ts, #658).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@dental/database'
import { getAppointmentStats } from './appointment.service.js'

const suffix = Date.now()

type Seeded = { id: string; doctorId: string; patientId: string }

async function seedTenant(name: string, timezone: string): Promise<Seeded> {
  const tenant = await prisma.tenant.create({
    data: { name: `Zone ${name}`, slug: `zone-appt-${name}-${suffix}`, timezone },
  })
  const doctor = await prisma.doctor.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Zone',
      lastName: 'Doctor',
      email: `zone-appt-${name}-${suffix}@test.com`,
    },
  })
  const patient = await prisma.patient.create({
    data: { tenantId: tenant.id, firstName: 'Zone', lastName: name },
  })
  return { id: tenant.id, doctorId: doctor.id, patientId: patient.id }
}

async function dropTenant(tenantId: string) {
  await prisma.appointment.deleteMany({ where: { tenantId } })
  await prisma.patient.deleteMany({ where: { tenantId } })
  await prisma.doctor.deleteMany({ where: { tenantId } })
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
}

async function seedAppointment(tenant: Seeded, startIso: string) {
  const start = new Date(startIso)
  return prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: tenant.patientId,
      doctorId: tenant.doctorId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      duration: 30,
    },
  })
}

describe('appointment.service — getAppointmentStats today/week in the tenant zone (#661)', () => {
  let mvd: Seeded
  let utc: Seeded

  // 22:00 on Saturday 31 October in Montevideo; already Sunday 1 November in UTC. So the MVD
  // tenant's "today" is 31 Oct and its week is Sun 25 - Sat 31 Oct, while the UTC tenant's
  // "today" is 1 Nov and its week starts that same day.
  const AT_MONTH_EDGE = new Date('2026-11-01T01:00:00.000Z')
  const OCT_31_MIDDAY = '2026-10-31T12:00:00.000Z'

  function pinClock(instant: Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instant)
  }

  beforeAll(async () => {
    mvd = await seedTenant('mvd661', 'America/Montevideo')
    utc = await seedTenant('utc661', 'UTC')
  })

  afterAll(async () => {
    await dropTenant(mvd.id)
    await dropTenant(utc.id)
  })

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: { in: [mvd.id, utc.id] } } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('G28: todayCount — a midday 31 Oct appointment is today for MVD (1), not for UTC (0)', async () => {
    await seedAppointment(mvd, OCT_31_MIDDAY)
    await seedAppointment(utc, OCT_31_MIDDAY)
    pinClock(AT_MONTH_EDGE)
    expect((await getAppointmentStats(mvd.id)).todayCount).toBe(1)
    expect((await getAppointmentStats(utc.id)).todayCount).toBe(0)
  })

  it('G29: weekCount — the same appointment is in MVD\'s current week (1) but not in UTC\'s (0)', async () => {
    await seedAppointment(mvd, OCT_31_MIDDAY)
    await seedAppointment(utc, OCT_31_MIDDAY)
    pinClock(AT_MONTH_EDGE)
    expect((await getAppointmentStats(mvd.id)).weekCount).toBe(1)
    expect((await getAppointmentStats(utc.id)).weekCount).toBe(0)
  })

  it('G30: midday Wednesday 28 Oct, appointment at that instant — both counters 1 for both zones (vacuity)', async () => {
    const instant = '2026-10-28T15:00:00.000Z'
    await seedAppointment(mvd, instant)
    await seedAppointment(utc, instant)
    pinClock(new Date(instant))
    const mvdStats = await getAppointmentStats(mvd.id)
    const utcStats = await getAppointmentStats(utc.id)
    expect(mvdStats.todayCount).toBe(1)
    expect(mvdStats.weekCount).toBe(1)
    expect(utcStats.todayCount).toBe(1)
    expect(utcStats.weekCount).toBe(1)
  })
})
