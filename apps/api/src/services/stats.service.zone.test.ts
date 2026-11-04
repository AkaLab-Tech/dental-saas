/**
 * getAppointmentStatsForPeriod — byDay bucket by the tenant's calendar day (task #654).
 *
 * DB-backed, in-process, host zone deliberately NOT pinned: the bucket depends only on the
 * tenant record, so the answer must be the same on any host. Each guard passes an EXPLICIT
 * October window so this file isolates the bucket from the default-window computation (which
 * the child-process zoned-day.zone.test.ts guards directly).
 *
 * Lives in a sibling file because stats.service.test.ts mocks the whole `@dental/database`
 * module (see stats.service.overview.test.ts for the same rationale).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'
import { getAppointmentStatsForPeriod } from './stats.service.js'

const WINDOW_START = new Date('2026-10-01T00:00:00.000Z')
const WINDOW_END = new Date('2026-11-01T23:59:59.999Z')

describe('stats.service — getAppointmentStatsForPeriod byDay bucket (#654)', () => {
  const suffix = Date.now()
  const tenantIds: string[] = []
  const doctorByTenant: Record<string, string> = {}
  const patientByTenant: Record<string, string> = {}

  async function seedTenant(name: string, timezone: string): Promise<string> {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: `Zone ${name}`, slug: `zone-${name}-${suffix}`, timezone },
    })
    tenantIds.push(tenant.id)
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    doctorByTenant[tenant.id] = (
      await prisma.doctor.create({
        data: { tenantId: tenant.id, firstName: 'Zone', lastName: 'Doctor', email: `zone-${name}-${suffix}@test.com` },
      })
    ).id
    patientByTenant[tenant.id] = (
      await prisma.patient.create({ data: { tenantId: tenant.id, firstName: 'Zone', lastName: name } })
    ).id
    return tenant.id
  }

  async function seedAppointment(tenantId: string, startIso: string) {
    const start = new Date(startIso)
    return prisma.appointment.create({
      data: {
        tenantId,
        patientId: patientByTenant[tenantId],
        doctorId: doctorByTenant[tenantId],
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        duration: 30,
      },
    })
  }

  let mvdId: string
  let utcId: string

  beforeAll(async () => {
    mvdId = await seedTenant('mvd', 'America/Montevideo')
    utcId = await seedTenant('utc', 'UTC')
  })

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await prisma.appointment.deleteMany({ where: { tenantId } })
      await prisma.patient.deleteMany({ where: { tenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId } })
      await prisma.subscription.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } })
    }
  })

  beforeEach(async () => {
    for (const tenantId of tenantIds) {
      await prisma.appointment.deleteMany({ where: { tenantId } })
    }
  })

  it('G8: Montevideo tenant, 21:00 local on 28 Oct (00:00Z 29 Oct) buckets on 2026-10-28', async () => {
    await seedAppointment(mvdId, '2026-10-29T00:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(mvdId, WINDOW_START, WINDOW_END)
    expect(stats.total).toBe(1)
    expect(stats.byDay).toEqual([{ date: '2026-10-28', count: 1 }])
  })

  it('G9: UTC tenant, same instant buckets on 2026-10-29 (vacuity: not a blanket -1 day)', async () => {
    await seedAppointment(utcId, '2026-10-29T00:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(utcId, WINDOW_START, WINDOW_END)
    expect(stats.byDay).toEqual([{ date: '2026-10-29', count: 1 }])
  })

  it('G10: Montevideo tenant, 20:00 local on 28 Oct (23:00Z) buckets on 2026-10-28 (control)', async () => {
    await seedAppointment(mvdId, '2026-10-28T23:00:00.000Z')
    const stats = await getAppointmentStatsForPeriod(mvdId, WINDOW_START, WINDOW_END)
    expect(stats.byDay).toEqual([{ date: '2026-10-28', count: 1 }])
  })
})
