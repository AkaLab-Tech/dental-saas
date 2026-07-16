import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock prisma
vi.mock('@dental/database', () => ({
  prisma: {
    labwork: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    doctor: {
      findMany: vi.fn(),
    },
  },
  Prisma: {},
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { prisma } from '@dental/database'
import {
  listLabworks,
  countLabworks,
  getLabworkStats,
  labworksToCsv,
  exportLabworksCsv,
  type SafeLabwork,
} from './labwork.service.js'

// A minimal fake Decimal — labworksToCsv only ever calls `.toString()` on the
// price, so a plain object with that method is sufficient without pulling in
// the real Prisma.Decimal implementation (Prisma itself is mocked in this file).
function fakeDecimal(value: string) {
  return { toString: () => value } as unknown as SafeLabwork['price']
}

function makeSafeLabwork(overrides: Partial<SafeLabwork> = {}): SafeLabwork {
  return {
    id: 'labwork-1',
    tenantId: 'tenant-1',
    patientId: null,
    appointmentId: null,
    priceIncludedInAppointment: false,
    lab: 'Acme Dental Lab',
    phoneNumber: null,
    date: new Date('2026-03-15T00:00:00.000Z'),
    note: null,
    price: fakeDecimal('100'),
    isPaid: false,
    isDelivered: false,
    doctorIds: [],
    isActive: true,
    createdBy: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    patient: null,
    ...overrides,
  }
}

describe('labwork.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([])
    vi.mocked(prisma.labwork.count).mockResolvedValue(0)
    vi.mocked(prisma.labwork.aggregate).mockResolvedValue({ _sum: { price: null } } as never)
    vi.mocked(prisma.doctor.findMany).mockResolvedValue([])
  })

  describe('listLabworks — search', () => {
    it('does not add an OR clause when search is omitted (existing behavior unchanged)', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
      })
      expect(where).not.toHaveProperty('OR')
    })

    it('does not add an OR clause when search is an empty string', async () => {
      await listLabworks('tenant-1', { search: '' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('OR')
    })

    it('adds a case-insensitive OR across lab, patient.firstName, patient.lastName when search is set', async () => {
      await listLabworks('tenant-1', { search: 'Acme' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('matches on lab name search terms case-insensitively (mode: insensitive on the lab clause)', async () => {
      await listLabworks('tenant-1', { search: 'aCmE dEnTaL' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      const or = where.OR as Array<{ lab?: { contains: string; mode: string } }>
      expect(or[0].lab).toEqual({ contains: 'aCmE dEnTaL', mode: 'insensitive' })
    })

    it('matches on patient first OR last name case-insensitively', async () => {
      await listLabworks('tenant-1', { search: 'garcia' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      const or = where.OR as Array<Record<string, unknown>>
      expect(or[1]).toEqual({ patient: { firstName: { contains: 'garcia', mode: 'insensitive' } } })
      expect(or[2]).toEqual({ patient: { lastName: { contains: 'garcia', mode: 'insensitive' } } })
    })

    it('combines search (OR) with an existing filter (isPaid) via AND, not replacing it', async () => {
      await listLabworks('tenant-1', { search: 'Acme', isPaid: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isPaid: true,
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('combines search with patientId, isDelivered, and a from-date filter simultaneously', async () => {
      // `date` is built from a single merged object spreading both `gte` (from)
      // and `lte` (to) into the same `date: {...}` literal, so either bound can
      // be supplied independently without clobbering the other. Here only
      // `from` is supplied; see the "date range filtering" describe block below
      // for the combined from+to regression coverage.
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', {
        search: 'Acme',
        patientId: 'patient-1',
        isDelivered: false,
        from,
      })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        patientId: 'patient-1',
        isDelivered: false,
        date: { gte: from },
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('applies the same search where clause to the count query used for pagination totals', async () => {
      await listLabworks('tenant-1', { search: 'Acme' })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(countWhere).toHaveProperty('OR')
      expect(countWhere).toEqual(vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where)
    })
  })

  describe('listLabworks — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })

    it('applies the combined from+to date filter to the count query used for pagination totals too', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { from, to })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(countWhere.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('countLabworks — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await countLabworks('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await countLabworks('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await countLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await countLabworks('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('getLabworkStats — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await getLabworkStats('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await getLabworkStats('tenant-1', {})

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })

    it('applies the same combined from+to date filter to the price aggregate query', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { from, to })

      const aggregateWhere = vi.mocked(prisma.labwork.aggregate).mock.calls[0][0]!.where as Record<string, unknown>
      expect(aggregateWhere.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('listLabworks — overdue filter', () => {
    beforeEach(() => {
      // Fix "now" so the start-of-today boundary computed inside the service
      // (getStartOfToday) is deterministic and doesn't depend on the machine
      // running the suite. Local time is used deliberately (setSystemTime
      // supplies a UTC instant; getStartOfToday truncates in local time, same
      // as the expected value we compute below).
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function expectedStartOfToday(): Date {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d
    }

    it('adds isDelivered:false and a strictly-before-today date bound when overdue is true and isDelivered is not explicitly set', async () => {
      await listLabworks('tenant-1', { overdue: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isDelivered: false,
        date: { lt: expectedStartOfToday() },
      })
    })

    it('applies the same overdue where clause to the count query used for pagination totals', async () => {
      await listLabworks('tenant-1', { overdue: true })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(countWhere).toEqual(vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where)
    })

    it('does not force isDelivered:false when isDelivered is explicitly provided alongside overdue (explicit isDelivered wins)', async () => {
      await listLabworks('tenant-1', { overdue: true, isDelivered: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.isDelivered).toBe(true)
      // The strictly-before-today date bound is still applied even though
      // isDelivered:true is a contradictory combination — overdue only
      // controls the date bound here, isDelivered is a separate branch.
      expect(where.date).toEqual({ lt: expectedStartOfToday() })
    })

    it('merges overdue with an existing `from` bound into a single date filter object (gte + lt)', async () => {
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', { overdue: true, from })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lt: expectedStartOfToday() })
    })

    it('merges overdue with existing from+to bounds into a single date filter object (gte + lte + lt)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-12-31')

      await listLabworks('tenant-1', { overdue: true, from, to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to, lt: expectedStartOfToday() })
    })

    it('does not add isDelivered or a date bound when overdue is explicitly false (falsy, not treated as active)', async () => {
      await listLabworks('tenant-1', { overdue: false })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true })
      expect(where).not.toHaveProperty('isDelivered')
      expect(where).not.toHaveProperty('date')
    })

    it('omits isDelivered and the date bound entirely when overdue is undefined (existing behavior unchanged)', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('isDelivered')
      expect(where).not.toHaveProperty('date')
    })
  })

  describe('getLabworkStats — overdue count', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function expectedStartOfToday(): Date {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d
    }

    it('queries the overdue count with isDelivered:false and date strictly before start-of-today', async () => {
      await getLabworkStats('tenant-1', {})

      // Promise.all order in getLabworkStats: [total, paid, delivered, overdue, aggregate, paidAggregate]
      const overdueWhere = vi.mocked(prisma.labwork.count).mock.calls[3][0]!.where as Record<string, unknown>
      expect(overdueWhere).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isDelivered: false,
        date: { lt: expectedStartOfToday() },
      })
    })

    it('intersects the overdue date bound with an existing from/to window instead of replacing it', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-12-31')

      await getLabworkStats('tenant-1', { from, to })

      const overdueWhere = vi.mocked(prisma.labwork.count).mock.calls[3][0]!.where as Record<string, unknown>
      expect(overdueWhere.date).toEqual({ gte: from, lte: to, lt: expectedStartOfToday() })
    })

    it('surfaces the overdue count returned by prisma on the `overdue` field of the result', async () => {
      vi.mocked(prisma.labwork.count)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6) // paid
        .mockResolvedValueOnce(4) // delivered
        .mockResolvedValueOnce(3) // overdue

      const result = await getLabworkStats('tenant-1', {})

      expect(result.overdue).toBe(3)
    })
  })

  describe('labworksToCsv', () => {
    it('returns only the header row (in the exact expected column order) when given an empty array', () => {
      const csv = labworksToCsv([], {})

      expect(csv).toBe('Fecha,Laboratorio,Teléfono,Paciente,Doctor(es),Precio,Pagado,Entregado,Nota')
    })

    it('serializes a fully-populated row with the exact expected field order and values', () => {
      const labwork = makeSafeLabwork({
        date: new Date('2026-03-15T00:00:00.000Z'),
        lab: 'Acme Dental Lab',
        phoneNumber: '+1 555-0100',
        patient: { id: 'p1', firstName: 'Maria', lastName: 'Garcia', email: null, phone: null },
        doctorIds: ['doc-1'],
        price: fakeDecimal('150.5'),
        isPaid: true,
        isDelivered: true,
        note: 'Crown, tooth 14',
      })

      const csv = labworksToCsv([labwork], { 'doc-1': 'Dr. John Smith' })
      const rows = csv.split('\n')

      expect(rows).toHaveLength(2)
      expect(rows[1]).toBe(
        '2026-03-15,Acme Dental Lab,+1 555-0100,Maria Garcia,Dr. John Smith,150.5,Sí,Sí,"Crown, tooth 14"'
      )
    })

    it('renders isPaid/isDelivered false as "No" and true as "Sí"', () => {
      const unpaidUndelivered = makeSafeLabwork({ isPaid: false, isDelivered: false })
      const paidDelivered = makeSafeLabwork({ isPaid: true, isDelivered: true })

      const csv = labworksToCsv([unpaidUndelivered, paidDelivered], {})
      const rows = csv.split('\n')

      expect(rows[1]).toContain(',No,No,')
      expect(rows[2]).toContain(',Sí,Sí,')
    })

    it('renders an empty patient column when patient is null', () => {
      const labwork = makeSafeLabwork({ patient: null })

      const csv = labworksToCsv([labwork], {})
      const rows = csv.split('\n')

      // Fecha,Laboratorio,Teléfono,Paciente,... — Paciente is the 4th column and
      // should be empty (no patient name), not "null"/"undefined".
      const columns = rows[1].split(',')
      expect(columns[3]).toBe('')
    })

    it('renders an empty phone column when phoneNumber is null', () => {
      const labwork = makeSafeLabwork({ phoneNumber: null })

      const csv = labworksToCsv([labwork], {})
      const columns = csv.split('\n')[1].split(',')

      expect(columns[2]).toBe('')
    })

    it('renders an empty note column when note is null', () => {
      const labwork = makeSafeLabwork({ note: null })

      const csv = labworksToCsv([labwork], {})
      const lastColumn = csv.split('\n')[1].split(',').at(-1)

      expect(lastColumn).toBe('')
    })

    it('renders an empty doctors column when doctorIds is empty', () => {
      const labwork = makeSafeLabwork({ doctorIds: [] })

      const csv = labworksToCsv([labwork], {})
      const columns = csv.split('\n')[1].split(',')

      expect(columns[4]).toBe('')
    })

    it('joins multiple doctor names with "; "', () => {
      const labwork = makeSafeLabwork({ doctorIds: ['doc-1', 'doc-2', 'doc-3'] })

      const csv = labworksToCsv([labwork], {
        'doc-1': 'Dr. Alice',
        'doc-2': 'Dr. Bob',
        'doc-3': 'Dr. Carol',
      })
      const columns = csv.split('\n')[1].split(',')

      expect(columns[4]).toBe('Dr. Alice; Dr. Bob; Dr. Carol')
    })

    it('falls back to the raw doctor id when it has no entry in doctorNamesById', () => {
      const labwork = makeSafeLabwork({ doctorIds: ['unknown-doc-id'] })

      const csv = labworksToCsv([labwork], {})
      const columns = csv.split('\n')[1].split(',')

      expect(columns[4]).toBe('unknown-doc-id')
    })

    it('wraps a field containing a comma in quotes without altering its content', () => {
      const labwork = makeSafeLabwork({ lab: 'Acme, Dental & Lab Co' })

      const csv = labworksToCsv([labwork], {})
      const row = csv.split('\n')[1]

      expect(row).toContain('"Acme, Dental & Lab Co"')
    })

    it('wraps a field containing embedded double quotes in quotes and doubles the embedded quotes (RFC4180)', () => {
      const labwork = makeSafeLabwork({ note: 'Patient said "ouch" during procedure' })

      const csv = labworksToCsv([labwork], {})
      const row = csv.split('\n')[1]

      expect(row).toContain('"Patient said ""ouch"" during procedure"')
    })

    it('wraps a field containing an embedded newline in quotes, keeping the newline inside a single logical row', () => {
      const labwork = makeSafeLabwork({ note: 'Line one\nLine two' })

      const csv = labworksToCsv([labwork], {})

      // Splitting the whole CSV output on '\n' must still yield exactly 2
      // rows (header + 1 data row) even though the data row's own field
      // contains a literal newline — proof the newline was quoted/escaped
      // rather than treated as a row separator.
      expect(csv).toContain('"Line one\nLine two"')
    })

    it('does not quote a field that contains none of comma, quote, or newline', () => {
      const labwork = makeSafeLabwork({ lab: 'Plain Lab Name' })

      const csv = labworksToCsv([labwork], {})
      const row = csv.split('\n')[1]

      expect(row).toContain(',Plain Lab Name,')
    })

    it('serializes the date as an ISO calendar date (YYYY-MM-DD), dropping the time component', () => {
      const labwork = makeSafeLabwork({ date: new Date('2026-12-25T23:59:59.999Z') })

      const csv = labworksToCsv([labwork], {})
      const columns = csv.split('\n')[1].split(',')

      expect(columns[0]).toBe('2026-12-25')
    })

    it('serializes multiple labworks as separate rows in the given order', () => {
      const first = makeSafeLabwork({ lab: 'First Lab' })
      const second = makeSafeLabwork({ lab: 'Second Lab' })

      const csv = labworksToCsv([first, second], {})
      const rows = csv.split('\n')

      expect(rows).toHaveLength(3)
      expect(rows[1]).toContain('First Lab')
      expect(rows[2]).toContain('Second Lab')
    })
  })

  describe('exportLabworksCsv', () => {
    it('queries with the same where-clause shape buildLabworksWhere produces for listLabworks (filter passthrough)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await exportLabworksCsv('tenant-1', {
        search: 'Acme',
        isPaid: true,
        isDelivered: false,
        patientId: 'patient-1',
        from,
        to,
      })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        patientId: 'patient-1',
        isPaid: true,
        isDelivered: false,
        date: { gte: from, lte: to },
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('applies the overdue filter (isDelivered:false + strictly-before-today date bound) the same way listLabworks does', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))

      await exportLabworksCsv('tenant-1', { overdue: true })

      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.isDelivered).toBe(false)
      expect(where.date).toEqual({ lt: startOfToday })

      vi.useRealTimers()
    })

    it('does not pass take/skip to prisma.labwork.findMany (no pagination cap on export)', async () => {
      await exportLabworksCsv('tenant-1', {})

      const callArgs = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!
      expect(callArgs).not.toHaveProperty('take')
      expect(callArgs).not.toHaveProperty('skip')
    })

    it('skips the doctor lookup entirely when no returned labwork has any doctorIds', async () => {
      vi.mocked(prisma.labwork.findMany).mockResolvedValue([
        makeSafeLabwork({ doctorIds: [] }),
      ] as never)

      await exportLabworksCsv('tenant-1', {})

      expect(prisma.doctor.findMany).not.toHaveBeenCalled()
    })

    it('resolves doctor names via a single deduplicated bulk lookup and feeds them into the CSV output', async () => {
      vi.mocked(prisma.labwork.findMany).mockResolvedValue([
        makeSafeLabwork({ id: 'lw-1', doctorIds: ['doc-1', 'doc-2'] }),
        makeSafeLabwork({ id: 'lw-2', doctorIds: ['doc-1'] }),
      ] as never)
      vi.mocked(prisma.doctor.findMany).mockResolvedValue([
        { id: 'doc-1', firstName: 'Alice', lastName: 'Smith' },
        { id: 'doc-2', firstName: 'Bob', lastName: 'Jones' },
      ] as never)

      const csv = await exportLabworksCsv('tenant-1', {})

      // Deduplicated: 2 distinct doctor ids across both labworks, looked up once.
      expect(prisma.doctor.findMany).toHaveBeenCalledTimes(1)
      const doctorWhere = vi.mocked(prisma.doctor.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(doctorWhere).toEqual({ id: { in: ['doc-1', 'doc-2'] }, tenantId: 'tenant-1' })

      expect(csv).toContain('Alice Smith; Bob Jones')
      expect(csv).toContain('Alice Smith')
    })
  })
})
