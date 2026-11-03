import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@dental/database'
import { createPatient } from './patient.service.js'

// Task #658 G7: the seed lands on the stored row, using the tenant's timezone.
// Only Date is faked so the database driver's timers keep running.
describe('createPatient showPrimaryTeeth seed (#658)', () => {
  let tenantId: string
  const suffix = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Primary Teeth 658', slug: `primary-teeth-658-${suffix}`, timezone: 'America/Montevideo' },
    })
    tenantId = tenant.id
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  it('a dob turning 12 tomorrow in the tenant zone (already that day in UTC) is stored showPrimaryTeeth: true', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 22:00 on 3 Nov in Montevideo; 4 Nov, the 12th birthday, in UTC.
    vi.setSystemTime(new Date('2026-11-04T01:00:00.000Z'))
    const created = await createPatient(tenantId, {
      firstName: 'Teeth',
      lastName: 'Eve',
      dob: new Date('2014-11-04T00:00:00.000Z'),
    })
    expect(created.showPrimaryTeeth).toBe(true)
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.showPrimaryTeeth).toBe(true)
  })

  it('on the birthday itself in the tenant zone it is stored false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-04T15:00:00.000Z'))
    const created = await createPatient(tenantId, {
      firstName: 'Teeth',
      lastName: 'Day',
      dob: new Date('2014-11-04T00:00:00.000Z'),
    })
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.showPrimaryTeeth).toBe(false)
  })

  it('no dob still seeds false', async () => {
    const created = await createPatient(tenantId, { firstName: 'Teeth', lastName: 'None' })
    expect(created.showPrimaryTeeth).toBe(false)
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.showPrimaryTeeth).toBe(false)
  })
})
