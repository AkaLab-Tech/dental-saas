/**
 * stats.service — calendar-day and calendar-month aggregates bucket by the TENANT's zone.
 *
 * G8-G10 (task #654): getAppointmentStatsForPeriod's byDay bucket.
 * G21-G27 (task #661): the monthly windows and month keys of getOverviewStats,
 * getAppointmentTypeStats, getDoctorPerformanceStats, getPatientsGrowthStats and
 * getRevenueStats.
 *
 * DB-backed, in-process, host zone deliberately NOT pinned: every guard seeds two tenants with
 * different zones and asserts the two answers differ in a stated way. That is what makes the
 * #661 guards fail on ANY host before the fix — the unfixed code reads the host's zone, so both
 * tenants necessarily get the same answer, whatever the host is.
 *
 * The clock is pinned with `vi.useFakeTimers({ toFake: ['Date'] })`; only Date is faked so the
 * database driver's timers keep running (the pattern shipped in
 * patient.service.primary-teeth.test.ts, #658). It touches nothing in process.env, so the
 * `vi.stubEnv('TZ', ...)` failure mode that forces zoned-day.zone.test.ts into a child process
 * does not apply here.
 *
 * Lives in a sibling file because stats.service.test.ts mocks the whole `@dental/database`
 * module (see stats.service.overview.test.ts for the same rationale).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@dental/database'
import {
  getAppointmentStatsForPeriod,
  getOverviewStats,
  getAppointmentTypeStats,
  getDoctorPerformanceStats,
  getPatientsGrowthStats,
  getRevenueStats,
} from './stats.service.js'

const WINDOW_START = new Date('2026-10-01T00:00:00.000Z')
const WINDOW_END = new Date('2026-11-01T23:59:59.999Z')

const suffix = Date.now()

type Seeded = { id: string; doctorId: string; patientId: string }

async function ensureFreePlan() {
  const existing = await prisma.plan.findUnique({ where: { name: 'free' } })
  if (existing) return existing
  return prisma.plan.create({
    data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
  })
}

/**
 * One tenant with one doctor and one patient. `patientCreatedAt` pins the base patient outside
 * any window a guard asserts over (G25 counts patients by creation month, so a base patient
 * created at the real `now` would land inside one of the asserted months).
 */
async function seedTenant(name: string, timezone: string, patientCreatedAt?: Date): Promise<Seeded> {
  const freePlan = await ensureFreePlan()
  const tenant = await prisma.tenant.create({
    data: { name: `Zone ${name}`, slug: `zone-${name}-${suffix}`, timezone },
  })
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: freePlan.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  const doctor = await prisma.doctor.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Zone',
      lastName: 'Doctor',
      email: `zone-${name}-${suffix}@test.com`,
    },
  })
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Zone',
      lastName: name,
      ...(patientCreatedAt ? { createdAt: patientCreatedAt } : {}),
    },
  })
  return { id: tenant.id, doctorId: doctor.id, patientId: patient.id }
}

async function dropTenant(tenantId: string) {
  await prisma.appointment.deleteMany({ where: { tenantId } })
  await prisma.patient.deleteMany({ where: { tenantId } })
  await prisma.doctor.deleteMany({ where: { tenantId } })
  await prisma.subscription.deleteMany({ where: { tenantId } })
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
}

async function seedAppointment(
  tenant: Seeded,
  startIso: string,
  overrides: Record<string, unknown> = {}
) {
  const start = new Date(startIso)
  return prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      patientId: tenant.patientId,
      doctorId: tenant.doctorId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      duration: 30,
      ...overrides,
    },
  })
}

/**
 * getAppointmentStatsForPeriod — byDay bucket by the tenant's calendar day (task #654).
 *
 * Each guard passes an EXPLICIT October window so this block isolates the bucket from the
 * default-window computation (which the child-process zoned-day.zone.test.ts guards directly).
 */
describe('stats.service — getAppointmentStatsForPeriod byDay bucket (#654)', () => {
  let mvd: Seeded
  let utc: Seeded

  beforeAll(async () => {
    mvd = await seedTenant('mvd', 'America/Montevideo')
    utc = await seedTenant('utc', 'UTC')
  })

  afterAll(async () => {
    await dropTenant(mvd.id)
    await dropTenant(utc.id)
  })

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: { in: [mvd.id, utc.id] } } })
  })

  it('G8: Montevideo tenant, 21:00 local on 28 Oct (00:00Z 29 Oct) buckets on 2026-10-28', async () => {
    await seedAppointment(mvd, '2026-10-29T00:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(mvd.id, WINDOW_START, WINDOW_END)
    expect(stats.total).toBe(1)
    expect(stats.byDay).toEqual([{ date: '2026-10-28', count: 1 }])
  })

  it('G9: UTC tenant, same instant buckets on 2026-10-29 (vacuity: not a blanket -1 day)', async () => {
    await seedAppointment(utc, '2026-10-29T00:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(utc.id, WINDOW_START, WINDOW_END)
    expect(stats.byDay).toEqual([{ date: '2026-10-29', count: 1 }])
  })

  it('G10: Montevideo tenant, 20:00 local on 28 Oct (23:00Z) buckets on 2026-10-28 (control)', async () => {
    await seedAppointment(mvd, '2026-10-28T23:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(mvd.id, WINDOW_START, WINDOW_END)
    expect(stats.byDay).toEqual([{ date: '2026-10-28', count: 1 }])
  })
})

/**
 * The monthly aggregates (task #661). `AT_MONTH_EDGE` is 22:00 on 31 October in Montevideo and
 * already 1 November in UTC, so the MVD tenant is still in October while the UTC tenant is in
 * November — the two answers must differ.
 */
describe('stats.service — monthly aggregates use the tenant calendar month (#661)', () => {
  let mvd: Seeded
  let utc: Seeded

  const AT_MONTH_EDGE = new Date('2026-11-01T01:00:00.000Z')
  const MID_OCTOBER = '2026-10-15T12:00:00.000Z'
  // Out of every window these guards assert over, so the base patients never contribute.
  const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

  function pinClock(instant: Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instant)
  }

  beforeAll(async () => {
    mvd = await seedTenant('mvd661', 'America/Montevideo', LONG_AGO)
    utc = await seedTenant('utc661', 'UTC', LONG_AGO)
  })

  afterAll(async () => {
    await dropTenant(mvd.id)
    await dropTenant(utc.id)
  })

  beforeEach(async () => {
    const tenantIds = [mvd.id, utc.id]
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.patient.deleteMany({
      where: { tenantId: { in: tenantIds }, id: { notIn: [mvd.patientId, utc.patientId] } },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('G21: getOverviewStats.appointmentsThisMonth — a 15 Oct appointment counts for MVD (1), not for UTC (0)', async () => {
    await seedAppointment(mvd, MID_OCTOBER)
    await seedAppointment(utc, MID_OCTOBER)
    pinClock(AT_MONTH_EDGE)
    expect((await getOverviewStats(mvd.id)).appointmentsThisMonth).toBe(1)
    expect((await getOverviewStats(utc.id)).appointmentsThisMonth).toBe(0)
  })

  it('G22: same, with `now` mid-October — both tenants count it (vacuity: not a blanket zero)', async () => {
    await seedAppointment(mvd, MID_OCTOBER)
    await seedAppointment(utc, MID_OCTOBER)
    pinClock(new Date(MID_OCTOBER))
    expect((await getOverviewStats(mvd.id)).appointmentsThisMonth).toBe(1)
    expect((await getOverviewStats(utc.id)).appointmentsThisMonth).toBe(1)
  })

  it('G23: getAppointmentTypeStats — one October row for MVD, nothing for UTC', async () => {
    await seedAppointment(mvd, MID_OCTOBER, { type: 'Limpieza' })
    await seedAppointment(utc, MID_OCTOBER, { type: 'Limpieza' })
    pinClock(AT_MONTH_EDGE)
    expect(await getAppointmentTypeStats(mvd.id, mvd.doctorId)).toEqual([
      { type: 'Limpieza', count: 1 },
    ])
    expect(await getAppointmentTypeStats(utc.id, utc.doctorId)).toEqual([])
  })

  it('G24: getDoctorPerformanceStats with no explicit range — appointmentsCount 1 for MVD, 0 for UTC', async () => {
    await seedAppointment(mvd, MID_OCTOBER)
    await seedAppointment(utc, MID_OCTOBER)
    pinClock(AT_MONTH_EDGE)
    const mvdRows = await getDoctorPerformanceStats(mvd.id)
    const utcRows = await getDoctorPerformanceStats(utc.id)
    expect(mvdRows.find((r) => r.doctorId === mvd.doctorId)?.appointmentsCount).toBe(1)
    expect(utcRows.find((r) => r.doctorId === utc.doctorId)?.appointmentsCount).toBe(0)
  })

  it('G25: getPatientsGrowthStats — a 15 Oct patient is thisMonth for MVD and lastMonth for UTC', async () => {
    for (const tenant of [mvd, utc]) {
      await prisma.patient.create({
        data: {
          tenantId: tenant.id,
          firstName: 'Growth',
          lastName: 'October',
          createdAt: new Date(MID_OCTOBER),
        },
      })
    }
    pinClock(AT_MONTH_EDGE)
    const mvdStats = await getPatientsGrowthStats(mvd.id)
    const utcStats = await getPatientsGrowthStats(utc.id)
    // Both boundaries of each tenant are compared in ONE assertion, so a failure reports both
    // figures instead of hiding the second behind the first.
    const bounds = (s: { thisMonth: number; lastMonth: number }) => ({
      thisMonth: s.thisMonth,
      lastMonth: s.lastMonth,
    })
    expect(bounds(mvdStats)).toEqual({ thisMonth: 1, lastMonth: 0 })
    expect(bounds(utcStats)).toEqual({ thisMonth: 0, lastMonth: 1 })
  })

  it('G26: getRevenueStats.byMonth — a 22:00-local 31 Oct charge keys to 2026-10 for MVD, 2026-11 for UTC', async () => {
    const completed = { status: 'COMPLETED', cost: 178.3 }
    await seedAppointment(mvd, '2026-11-01T01:00:00.000Z', completed)
    await seedAppointment(utc, '2026-11-01T01:00:00.000Z', completed)
    pinClock(new Date('2026-11-15T12:00:00.000Z'))
    expect((await getRevenueStats(mvd.id, 6)).byMonth).toEqual([{ month: '2026-10', revenue: 178.3 }])
    expect((await getRevenueStats(utc.id, 6)).byMonth).toEqual([{ month: '2026-11', revenue: 178.3 }])
  })

  it('G27: same, with the charge at midday on 10 Nov — both key to 2026-11 (vacuity)', async () => {
    const completed = { status: 'COMPLETED', cost: 178.3 }
    await seedAppointment(mvd, '2026-11-10T12:00:00.000Z', completed)
    await seedAppointment(utc, '2026-11-10T12:00:00.000Z', completed)
    pinClock(new Date('2026-11-15T12:00:00.000Z'))
    expect((await getRevenueStats(mvd.id, 6)).byMonth).toEqual([{ month: '2026-11', revenue: 178.3 }])
    expect((await getRevenueStats(utc.id, 6)).byMonth).toEqual([{ month: '2026-11', revenue: 178.3 }])
  })
})
