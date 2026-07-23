import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma — getDoctorPerformanceStats only touches doctor/appointment/labwork.
vi.mock('@dental/database', () => ({
  prisma: {
    doctor: {
      findMany: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
    labwork: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { prisma } from '@dental/database'
import { getDoctorPerformanceStats } from './stats.service.js'

// A minimal fake Decimal — the service only ever calls `.toNumber()` on cost,
// price, and commissionPercentage, so a plain object with that method is
// sufficient without pulling in the real Prisma.Decimal implementation
// (Prisma itself is mocked in this file).
function fakeDecimal(value: number) {
  return { toNumber: () => value } as unknown as { toNumber: () => number }
}

describe('stats.service — getDoctorPerformanceStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] without querying appointments/labworks when the tenant has no active doctors', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([])

    const result = await getDoctorPerformanceStats('tenant-1')

    expect(result).toEqual([])
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
    expect(prisma.labwork.findMany).not.toHaveBeenCalled()
  })

  it('computes commission as (consultationBase + labworkBase) * pct / 100', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: fakeDecimal(20) },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { doctorId: 'doc-a', status: 'COMPLETED', cost: fakeDecimal(100), isPaid: true },
      { doctorId: 'doc-a', status: 'COMPLETED', cost: fakeDecimal(50), isPaid: true },
    ] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([
      { doctorIds: ['doc-a'], price: fakeDecimal(80) },
    ] as never)

    const [stats] = await getDoctorPerformanceStats('tenant-1')

    expect(stats.doctorId).toBe('doc-a')
    expect(stats.commissionPercentage).toBe(20)
    // consultationBase = 100 + 50 = 150; labworkBase = 80; commission = 230 * 20 / 100
    expect(stats.commission).toBe(46)
  })

  it('credits the FULL labwork price to every doctor listed in doctorIds (no split)', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: fakeDecimal(10) },
      { id: 'doc-b', firstName: 'Beto', lastName: 'Diaz', commissionPercentage: fakeDecimal(10) },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([
      { doctorIds: ['doc-a', 'doc-b'], price: fakeDecimal(100) },
    ] as never)

    const stats = await getDoctorPerformanceStats('tenant-1')

    const docA = stats.find((s) => s.doctorId === 'doc-a')!
    const docB = stats.find((s) => s.doctorId === 'doc-b')!

    // Both doctors get the full $100, not $50 each.
    expect(docA.commission).toBe(10) // 100 * 10 / 100
    expect(docB.commission).toBe(10) // 100 * 10 / 100
  })

  it('includes UNPAID and non-completed appointments in the commission base (billed, not paid)', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: fakeDecimal(50) },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { doctorId: 'doc-a', status: 'SCHEDULED', cost: fakeDecimal(200), isPaid: false },
    ] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([] as never)

    const [stats] = await getDoctorPerformanceStats('tenant-1')

    // `revenue` only counts COMPLETED + paid, so it stays 0 — but the
    // commission base is billed, so the unpaid/scheduled cost still counts.
    expect(stats.revenue).toBe(0)
    expect(stats.commission).toBe(100) // 200 * 50 / 100
  })

  it('returns commission = 0 and commissionPercentage = null when the doctor has no commission rate set', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: null },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { doctorId: 'doc-a', status: 'COMPLETED', cost: fakeDecimal(500), isPaid: true },
    ] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([] as never)

    const [stats] = await getDoctorPerformanceStats('tenant-1')

    expect(stats.commissionPercentage).toBeNull()
    expect(stats.commission).toBe(0)
  })

  it('queries appointments/labworks for the explicit startDate/endDate range when provided', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: null },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([] as never)

    const startDate = new Date('2020-01-01T00:00:00.000Z')
    const endDate = new Date('2020-01-31T23:59:59.999Z')

    await getDoctorPerformanceStats('tenant-1', startDate, endDate)

    const appointmentWhere = vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as {
      startTime: { gte: Date; lte: Date }
    }
    expect(appointmentWhere.startTime).toEqual({ gte: startDate, lte: endDate })

    const labworkWhere = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as {
      date: { gte: Date; lte: Date }
    }
    expect(labworkWhere.date).toEqual({ gte: startDate, lte: endDate })
  })

  it('defaults to the current calendar month when no startDate/endDate is given', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([
      { id: 'doc-a', firstName: 'Ana', lastName: 'Ruiz', commissionPercentage: null },
    ] as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([] as never)

    await getDoctorPerformanceStats('tenant-1')

    const now = new Date()
    const expectedStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const expectedEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    const appointmentWhere = vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as {
      startTime: { gte: Date; lte: Date }
    }
    expect(appointmentWhere.startTime).toEqual({ gte: expectedStart, lte: expectedEnd })
  })
})
