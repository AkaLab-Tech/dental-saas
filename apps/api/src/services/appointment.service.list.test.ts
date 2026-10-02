import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { listAppointments, countAppointments } from './appointment.service.js'

// #476: listAppointments and countAppointments must filter identically (they share
// one where-builder), and the service's own default page size stays 50. The route
// now always passes an explicit limit, so the 50 default is pinned here, directly.
describe('listAppointments / countAppointments (#476)', () => {
  let tenantId: string
  let patientId: string
  let doctorId: string
  let doctor2Id: string
  const suffix = Date.now()

  const mk = (i: number, month: number, over: Record<string, unknown> = {}) => {
    const start = new Date(Date.UTC(2032, month - 1, 1 + (i % 28), 8 + Math.floor(i / 28), 0, 0))
    return {
      tenantId,
      patientId,
      doctorId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60 * 1000),
      duration: 30,
      ...over,
    }
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'List Svc 476', slug: `list-svc-476-${suffix}` } })
    tenantId = tenant.id
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'List', lastName: 'Patient' } })
    patientId = patient.id
    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'List', lastName: 'Doctor', email: `list-doc-${suffix}@test.com` },
    })
    doctorId = doctor.id
    const doctor2 = await prisma.doctor.create({
      data: { tenantId, firstName: 'List2', lastName: 'Doctor', email: `list-doc2-${suffix}@test.com` },
    })
    doctor2Id = doctor2.id

    await prisma.appointment.createMany({
      data: [
        // 60 active SCHEDULED, doctor1, March
        ...Array.from({ length: 60 }, (_, i) => mk(i, 3, { status: 'SCHEDULED' })),
        // 20 active CANCELLED, doctor2, March
        ...Array.from({ length: 20 }, (_, i) => mk(i, 3, { status: 'CANCELLED', doctorId: doctor2Id })),
        // 7 inactive CANCELLED, doctor1, March
        ...Array.from({ length: 7 }, (_, i) => mk(i, 3, { status: 'CANCELLED', isActive: false })),
        // 5 active SCHEDULED, doctor1, April
        ...Array.from({ length: 5 }, (_, i) => mk(i, 4, { status: 'SCHEDULED' })),
      ],
    })
  })

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  const MARCH = { from: new Date('2032-03-01T00:00:00.000Z'), to: new Date('2032-03-31T23:59:59.999Z') }

  it('listAppointments with no limit returns at most 50 rows (the service default)', async () => {
    const rows = await listAppointments(tenantId)
    expect(rows.length).toBe(50)
  })

  it('listAppointments honours an explicit limit above 50 (service applies no cap of its own)', async () => {
    const rows = await listAppointments(tenantId, { ...MARCH, limit: 500 })
    expect(rows.length).toBe(80)
  })

  it('listAppointments orders by startTime ascending', async () => {
    const rows = await listAppointments(tenantId, { ...MARCH, limit: 500 })
    const times = rows.map((r) => new Date(r.startTime).getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('countAppointments with a two-sided range counts only rows inside it (old version let `to` overwrite `from`)', async () => {
    expect(await countAppointments(tenantId, MARCH)).toBe(80)
    expect(await countAppointments(tenantId, { from: new Date('2032-04-01T00:00:00.000Z') })).toBe(5)
    expect(await countAppointments(tenantId, { to: MARCH.to })).toBe(80)
  })

  it('countAppointments honours status, doctorId, patientId and includeInactive', async () => {
    expect(await countAppointments(tenantId, { ...MARCH, status: 'SCHEDULED' })).toBe(60)
    expect(await countAppointments(tenantId, { ...MARCH, status: 'CANCELLED' })).toBe(20)
    expect(await countAppointments(tenantId, { ...MARCH, status: 'CANCELLED', includeInactive: true })).toBe(27)
    expect(await countAppointments(tenantId, { ...MARCH, doctorId: doctor2Id })).toBe(20)
    expect(await countAppointments(tenantId, { ...MARCH, patientId })).toBe(80)
    expect(await countAppointments(tenantId, { ...MARCH, includeInactive: true })).toBe(87)
    expect(await countAppointments(tenantId)).toBe(85)
  })

  it('count equals the full list length for every filter combination (no drift)', async () => {
    const combos = [
      { ...MARCH },
      { ...MARCH, status: 'SCHEDULED' as const },
      { ...MARCH, includeInactive: true },
      { ...MARCH, doctorId: doctor2Id },
      { ...MARCH, doctorId, status: 'CANCELLED' as const, includeInactive: true },
      { patientId },
      { from: new Date('2032-04-01T00:00:00.000Z') },
    ]
    for (const combo of combos) {
      const rows = await listAppointments(tenantId, { ...combo, limit: 500 })
      expect(await countAppointments(tenantId, combo)).toBe(rows.length)
    }
  })

  it('count for an unknown tenant is 0', async () => {
    expect(await countAppointments(`nope-${suffix}`, MARCH)).toBe(0)
  })
})
