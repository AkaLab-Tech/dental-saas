import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { prisma } from '@dental/database'

import { api } from '../test/http.js'
import { generateToken } from '../test/tokens.js'
import {
  findCostBudgetOverlaps,
  formatReport,
  parseArgs,
  type CostBudgetOverlapReport,
} from './report-cost-budget-overlap.js'

const execFileAsync = promisify(execFile)
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Task #546: read-only report of appointments that carry BOTH a typed cost and
 * an EXECUTED budget item.
 *
 * Fixtures are built through the app's own flows (POST /patients/:id/budgets,
 * POST /appointments with budgetItemIds, PUT /appointments/:id/mark-done with
 * executedBudgetItemIds), so every EXECUTED link here is one production can
 * create. Only two things are written by hand, and both are states the API
 * reaches by other routes this suite does not exercise: soft-deleting an
 * appointment / a budget (isActive = false), and the tenant/patient/user rows.
 *
 * Every report call is scoped with `tenantId` to a fixture tenant, because the
 * test database may hold unrelated rows.
 *
 * No patient names: fixtures use opaque tokens as first/last names.
 */
describe('report-cost-budget-overlap (#546)', () => {
  const suffix = `${Date.now()}`

  let tenantId: string
  let otherTenantId: string
  let token: string
  let otherToken: string
  let doctorId: string
  let otherDoctorId: string
  let patientId: string
  let patientTwoId: string
  let otherPatientId: string

  let dayCounter = 0
  function nextTimes() {
    dayCounter += 1
    const start = new Date(Date.UTC(2031, 0, 1 + dayCounter, 10, 0, 0))
    const end = new Date(start.getTime() + 30 * 60_000)
    return { startTime: start.toISOString(), endTime: end.toISOString() }
  }

  async function createBudget(
    forPatientId: string,
    bearer: string,
    items: Array<{ description: string; unitPrice: number; toothNumber?: string; quantity?: number }>
  ) {
    const res = await api()
      .post(`/api/patients/${forPatientId}/budgets`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        status: 'APPROVED',
        items: items.map((i) => ({ quantity: 1, ...i })),
      })
    expect(res.status).toBe(201)
    const budgetId: string = res.body.data.id
    const rows = await prisma.budgetItem.findMany({
      where: { budgetId },
      orderBy: { order: 'asc' },
    })
    return { budgetId, items: rows }
  }

  async function createAppointment(
    body: { patientId: string; doctorId: string; cost?: number; budgetItemIds?: string[] },
    bearer = token
  ) {
    const res = await api()
      .post('/api/appointments')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ ...nextTimes(), ...body })
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  async function markDone(appointmentId: string, executedBudgetItemIds: string[], bearer = token) {
    const res = await api()
      .put(`/api/appointments/${appointmentId}/mark-done`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ executedBudgetItemIds })
    expect(res.status).toBe(200)
  }

  async function report(tenant = tenantId, limit?: number): Promise<CostBudgetOverlapReport> {
    return findCostBudgetOverlaps({ tenantId: tenant, limit })
  }

  function appointmentIds(r: CostBudgetOverlapReport): string[] {
    return r.tenants.flatMap((t) => t.patients.flatMap((p) => p.appointments.map((a) => a.appointmentId)))
  }

  function find(r: CostBudgetOverlapReport, appointmentId: string) {
    for (const t of r.tenants)
      for (const p of t.patients)
        for (const a of p.appointments)
          if (a.appointmentId === appointmentId) return { tenantId: t.tenantId, patientId: p.patientId, a }
    return undefined
  }

  beforeAll(async () => {
    const [tenant, otherTenant] = await Promise.all([
      prisma.tenant.create({ data: { name: `Overlap Report A ${suffix}`, slug: `overlap-a-${suffix}` } }),
      prisma.tenant.create({ data: { name: `Overlap Report B ${suffix}`, slug: `overlap-b-${suffix}` } }),
    ])
    tenantId = tenant.id
    otherTenantId = otherTenant.id

    const admin = await prisma.user.create({
      data: {
        email: `overlap-admin-a-${suffix}@test.com`,
        passwordHash: 'x',
        firstName: 'Admin',
        lastName: 'A',
        role: 'ADMIN',
        tenantId,
      },
    })
    const otherAdmin = await prisma.user.create({
      data: {
        email: `overlap-admin-b-${suffix}@test.com`,
        passwordHash: 'x',
        firstName: 'Admin',
        lastName: 'B',
        role: 'ADMIN',
        tenantId: otherTenantId,
      },
    })
    token = generateToken(admin.id, tenantId, 'ADMIN')
    otherToken = generateToken(otherAdmin.id, otherTenantId, 'ADMIN')

    const mkDoctor = (t: string, tag: string) =>
      prisma.doctor.create({
        data: { tenantId: t, firstName: 'Doc', lastName: tag, email: `overlap-doc-${tag}-${suffix}@test.com` },
      })
    const mkPatient = (t: string, tag: string) =>
      prisma.patient.create({ data: { tenantId: t, firstName: 'P', lastName: `fixture-${tag}` } })

    doctorId = (await mkDoctor(tenantId, 'a')).id
    otherDoctorId = (await mkDoctor(otherTenantId, 'b')).id
    patientId = (await mkPatient(tenantId, 'one')).id
    patientTwoId = (await mkPatient(tenantId, 'two')).id
    otherPatientId = (await mkPatient(otherTenantId, 'three')).id
  })

  afterAll(async () => {
    for (const t of [tenantId, otherTenantId]) {
      // BudgetItemAppointment rows cascade from appointment/budget item.
      await prisma.patientPayment.deleteMany({ where: { tenantId: t } })
      await prisma.appointment.deleteMany({ where: { tenantId: t } })
      await prisma.budget.deleteMany({ where: { tenantId: t } })
      await prisma.patient.deleteMany({ where: { tenantId: t } })
      await prisma.doctor.deleteMany({ where: { tenantId: t } })
      await prisma.user.deleteMany({ where: { tenantId: t } })
      await prisma.tenant.delete({ where: { id: t } }).catch(() => {})
    }
  })

  // ==========================================================================
  // Guard 1: typed cost + EXECUTED link appears, with both figures
  // ==========================================================================
  describe('positive case', () => {
    it('lists an appointment with a typed cost and an executed item, with both figures; dropping the cost removes it', async () => {
      const { items } = await createBudget(patientId, token, [
        { description: 'item-p1', unitPrice: 100, toothNumber: '16' },
      ])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 150,
        budgetItemIds: [items[0].id],
      })
      await markDone(appointmentId, [items[0].id])

      const row = find(await report(), appointmentId)
      expect(row).toBeDefined()
      expect(row!.tenantId).toBe(tenantId)
      expect(row!.patientId).toBe(patientId)
      expect(row!.a.typedCost).toBe('150.00')
      expect(row!.a.executedItemsSubtotal).toBe('100.00')
      expect(row!.a.appointmentStatus).toBe('COMPLETED')
      expect(row!.a.executedItems).toEqual([
        {
          budgetItemId: items[0].id,
          budgetId: items[0].budgetId,
          description: 'item-p1',
          toothNumber: '16',
          totalPrice: '100.00',
          itemStatus: 'EXECUTED',
          budgetStatus: 'COMPLETED',
        },
      ])

      // The text carries both figures and the ids.
      const text = formatReport(await report())
      expect(text).toContain(`Patient ${patientId}`)
      expect(text).toContain(`Appointment ${appointmentId}`)
      expect(text).toContain('Typed cost on the appointment: 150.00')
      expect(text).toContain('Executed items subtotal: 100.00')

      // Differential: remove the cost -> the row disappears.
      await prisma.appointment.update({ where: { id: appointmentId }, data: { cost: null } })
      expect(appointmentIds(await report())).not.toContain(appointmentId)
    })

    it('sums prices that binary floating point cannot represent exactly, to the exact printed cent', async () => {
      // The float artifact here comes from 0.1 + 0.2 = 0.30000000000000004 alone.
      // 33.33 * 3 is exactly 99.99 in doubles; it is in the fixture for the quantity path,
      // not for a rounding error. The raw float sum of the three is 100.28999999999999.
      //
      // What this catches, and the one thing it cannot: a float sum PRINTED RAW fails here.
      // A float sum still passed through toFixed(2) prints 100.29 and passes, and no fixture
      // can change that, because both money columns are Decimal(10, 2): an exact sum is a
      // whole number of cents and so sits a full 0.005 from the nearest rounding boundary,
      // which the double error has to exceed to move a printed cent. So for THIS report the
      // two worlds are output-identical and there is nothing to guard - no lint rule, no
      // wider assertion.
      //
      // Measured, because a bound stated without its breaking point gets believed where it
      // does not hold. It is driven by the running total's magnitude AND the number of
      // additions, not by either alone. Identical: 20 items at 99,999.99; 5,000 items at
      // 99,999.99; 2,000 items at the column maximum 99,999,999.99. Divergent: 3,000 items
      // at the column maximum (prints ...969.99 for ...970.00), and 100,000 items at
      // 99,999.99 (...8999.98 for ...9000.00). A per-appointment subtotal of clinic-priced
      // items sits many orders of magnitude inside the safe region; a future aggregate, such
      // as a per-tenant total, is not covered by that and must re-derive this.
      const { items } = await createBudget(patientId, token, [
        { description: 'item-dec-a', unitPrice: 0.1 },
        { description: 'item-dec-b', unitPrice: 0.2 },
        { description: 'item-dec-c', unitPrice: 33.33, quantity: 3 },
      ])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 33.33,
        budgetItemIds: items.map((i) => i.id),
      })
      await markDone(appointmentId, items.map((i) => i.id))

      const row = find(await report(), appointmentId)!.a
      expect(row.executedItems.map((i) => i.totalPrice).sort()).toEqual(['0.10', '0.20', '99.99'])
      expect(row.executedItemsSubtotal).toBe('100.29')
      expect(row.typedCost).toBe('33.33')
      expect(formatReport(await report())).toContain('Executed items subtotal: 100.29')
    })

    it('sums only EXECUTED links when an item has both SCHEDULED and EXECUTED links to the same appointment, and ignores scheduled-only siblings', async () => {
      const { items } = await createBudget(patientId, token, [
        { description: 'item-dual-a', unitPrice: 100 },
        { description: 'item-dual-b', unitPrice: 40, quantity: 2 },
        { description: 'item-dual-c', unitPrice: 7 },
      ])
      const [a, b, c] = items
      // a, b, c SCHEDULED on create; only a and b are confirmed as executed.
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 10,
        budgetItemIds: [a.id, b.id, c.id],
      })
      await markDone(appointmentId, [a.id, b.id])

      const links = await prisma.budgetItemAppointment.findMany({
        where: { appointmentId, budgetItemId: a.id },
      })
      expect(links.map((l) => l.role).sort()).toEqual(['EXECUTED', 'SCHEDULED'])

      const row = find(await report(), appointmentId)!
      expect(row.a.executedItems.map((i) => i.description).sort()).toEqual(['item-dual-a', 'item-dual-b'])
      // 100 + (40 x 2 = 80); item c (7) is only SCHEDULED; a is not counted twice.
      expect(row.a.executedItemsSubtotal).toBe('180.00')
      expect(row.a.typedCost).toBe('10.00')
    })

    it('keeps the typed cost and subtotal separate: no combined or difference figure is produced', async () => {
      const { items } = await createBudget(patientId, token, [{ description: 'item-sep', unitPrice: 60 }])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 25,
        budgetItemIds: [items[0].id],
      })
      await markDone(appointmentId, [items[0].id])
      const row = find(await report(), appointmentId)!.a
      expect(Object.keys(row).sort()).toEqual(
        [
          'appointmentId',
          'appointmentStatus',
          'executedItems',
          'executedItemsSubtotal',
          'startTime',
          'typedCost',
        ].sort()
      )
    })
  })

  // ==========================================================================
  // Guard 2: SCHEDULED is not work done
  // ==========================================================================
  describe('SCHEDULED link', () => {
    it('does not list a typed-cost appointment whose only link is SCHEDULED; executing the item makes the row appear', async () => {
      const { items } = await createBudget(patientId, token, [{ description: 'item-sched', unitPrice: 90 }])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 90,
        budgetItemIds: [items[0].id],
      })

      const links = await prisma.budgetItemAppointment.findMany({ where: { appointmentId } })
      expect(links.map((l) => l.role)).toEqual(['SCHEDULED'])
      expect(appointmentIds(await report())).not.toContain(appointmentId)

      // Differential: the app's own flip SCHEDULED -> EXECUTED (mark-done).
      await markDone(appointmentId, [items[0].id])
      expect(appointmentIds(await report())).toContain(appointmentId)
    })
  })

  // ==========================================================================
  // Guard 3: no typed cost
  // ==========================================================================
  describe('no typed cost', () => {
    it('does not list an appointment with executed items and a null cost; giving it a cost makes it appear', async () => {
      const { items } = await createBudget(patientId, token, [{ description: 'item-nocost', unitPrice: 55 }])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        budgetItemIds: [items[0].id],
      })
      await markDone(appointmentId, [items[0].id])

      const stored = await prisma.appointment.findUnique({ where: { id: appointmentId } })
      expect(stored!.cost).toBeNull()
      const link = await prisma.budgetItemAppointment.findFirst({ where: { appointmentId, role: 'EXECUTED' } })
      expect(link).not.toBeNull()
      expect(appointmentIds(await report())).not.toContain(appointmentId)

      await prisma.appointment.update({ where: { id: appointmentId }, data: { cost: 5 } })
      expect(find(await report(), appointmentId)!.a.typedCost).toBe('5.00')
    })

    it('lists a cost of zero (a typed 0 is not null)', async () => {
      const { items } = await createBudget(patientId, token, [{ description: 'item-zero', unitPrice: 12 }])
      const appointmentId = await createAppointment({
        patientId,
        doctorId,
        cost: 0,
        budgetItemIds: [items[0].id],
      })
      await markDone(appointmentId, [items[0].id])
      expect(find(await report(), appointmentId)!.a.typedCost).toBe('0.00')
    })
  })

  // ==========================================================================
  // Other predicate edges
  // ==========================================================================
  describe('predicate edges', () => {
    it('excludes an inactive appointment and an inactive budget; includes them again when reactivated', async () => {
      const { budgetId, items } = await createBudget(patientTwoId, token, [
        { description: 'item-edge-1', unitPrice: 10 },
        { description: 'item-edge-2', unitPrice: 20 },
      ])
      const apptInactive = await createAppointment({
        patientId: patientTwoId,
        doctorId,
        cost: 1,
        budgetItemIds: [items[0].id],
      })
      await markDone(apptInactive, [items[0].id])
      expect(appointmentIds(await report())).toContain(apptInactive)

      await prisma.appointment.update({ where: { id: apptInactive }, data: { isActive: false } })
      expect(appointmentIds(await report())).not.toContain(apptInactive)

      const apptBudgetInactive = await createAppointment({
        patientId: patientTwoId,
        doctorId,
        cost: 2,
        budgetItemIds: [items[1].id],
      })
      await markDone(apptBudgetInactive, [items[1].id])
      expect(appointmentIds(await report())).toContain(apptBudgetInactive)

      await prisma.budget.update({ where: { id: budgetId }, data: { isActive: false } })
      expect(appointmentIds(await report())).not.toContain(apptBudgetInactive)

      await prisma.budget.update({ where: { id: budgetId }, data: { isActive: true } })
      expect(appointmentIds(await report())).toContain(apptBudgetInactive)
    })

    it('does not filter on budget or item status: a CANCELLED budget is printed, not hidden', async () => {
      const { budgetId, items } = await createBudget(patientTwoId, token, [
        { description: 'item-cancelled-budget', unitPrice: 33 },
      ])
      const appointmentId = await createAppointment({
        patientId: patientTwoId,
        doctorId,
        cost: 3,
        budgetItemIds: [items[0].id],
      })
      await markDone(appointmentId, [items[0].id])
      await prisma.budget.update({ where: { id: budgetId }, data: { status: 'CANCELLED' } })

      const row = find(await report(), appointmentId)!
      expect(row.a.executedItems[0].budgetStatus).toBe('CANCELLED')
      expect(formatReport(await report())).toContain(`budget ${budgetId} status CANCELLED`)
    })

    it('scopes by tenant and groups by tenant then patient', async () => {
      const mine = await createBudget(patientId, token, [{ description: 'item-scope-a', unitPrice: 1 }])
      const theirs = await createBudget(otherPatientId, otherToken, [{ description: 'item-scope-b', unitPrice: 2 }])
      const apptMine = await createAppointment({
        patientId,
        doctorId,
        cost: 9,
        budgetItemIds: [mine.items[0].id],
      })
      const apptTheirs = await createAppointment(
        { patientId: otherPatientId, doctorId: otherDoctorId, cost: 8, budgetItemIds: [theirs.items[0].id] },
        otherToken
      )
      await markDone(apptMine, [mine.items[0].id])
      await markDone(apptTheirs, [theirs.items[0].id], otherToken)

      const scopedA = await report(tenantId)
      expect(scopedA.tenants.map((t) => t.tenantId)).toEqual([tenantId])
      expect(appointmentIds(scopedA)).toContain(apptMine)
      expect(appointmentIds(scopedA)).not.toContain(apptTheirs)

      const all = await findCostBudgetOverlaps({})
      expect(find(all, apptMine)!.tenantId).toBe(tenantId)
      expect(find(all, apptTheirs)!.tenantId).toBe(otherTenantId)
      expect(find(all, apptTheirs)!.patientId).toBe(otherPatientId)
      expect(all.appointmentCount).toBe(appointmentIds(all).length)
    })

    it('honours --limit as a cap on appointments', async () => {
      const scoped = await report()
      expect(scoped.appointmentCount).toBeGreaterThan(2)
      const limited = await report(tenantId, 2)
      expect(limited.appointmentCount).toBe(2)
      expect(appointmentIds(limited)).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Guard 4: read-only
  // ==========================================================================
  describe('read-only', () => {
    const AFFECTED_TABLES = [
      'appointment',
      'budget',
      'budgetItem',
      'budgetItemAppointment',
      'patientPayment',
      'patient',
    ] as const

    async function snapshot() {
      const counts: Record<string, number> = {}
      for (const t of AFFECTED_TABLES) {
        counts[t] = await (prisma[t] as unknown as { count: () => Promise<number> }).count()
      }
      // Counts are blind to an UPDATE, so also fingerprint the row contents.
      const appts = await prisma.appointment.findMany({ where: { tenantId }, orderBy: { id: 'asc' } })
      const links = await prisma.budgetItemAppointment.findMany({
        where: { appointment: { tenantId } },
        orderBy: [{ appointmentId: 'asc' }, { budgetItemId: 'asc' }, { role: 'asc' }],
      })
      const items = await prisma.budgetItem.findMany({
        where: { budget: { tenantId } },
        orderBy: { id: 'asc' },
      })
      const budgets = await prisma.budget.findMany({ where: { tenantId }, orderBy: { id: 'asc' } })
      return { counts, content: JSON.stringify({ appts, links, items, budgets }) }
    }

    /**
     * Records every statement the pg driver is asked to run. The script's
     * Prisma client sits on a pg Pool (exposed on globalThis outside
     * production), so patching the Client prototype sees all SQL, including
     * anything issued through $executeRaw or a transaction.
     */
    function spyOnSql() {
      const pool = (globalThis as unknown as { prismaPool?: { Client: { prototype: { query: unknown } } } })
        .prismaPool
      if (!pool) throw new Error('prismaPool not exposed; cannot observe SQL')
      const proto = pool.Client.prototype as { query: (...args: unknown[]) => unknown }
      const original = proto.query
      const statements: string[] = []
      proto.query = function (this: unknown, ...args: unknown[]) {
        const first = args[0]
        const text = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '')
        statements.push(text)
        return original.apply(this, args)
      }
      return {
        statements,
        restore() {
          proto.query = original
        },
      }
    }

    it('changes no row count and no row content, and issues no write statement', async () => {
      const before = await snapshot()
      expect(before.counts.budgetItemAppointment).toBeGreaterThan(0)

      const spy = spyOnSql()
      let result: CostBudgetOverlapReport
      try {
        result = await findCostBudgetOverlaps({ tenantId })
        formatReport(result)
      } finally {
        spy.restore()
      }
      expect(result.appointmentCount).toBeGreaterThan(0)

      // The spy is not blind: it saw the report's own SELECT.
      const selects = spy.statements.filter((s) => /^\s*select\b/i.test(s))
      expect(selects.length).toBeGreaterThan(0)
      expect(selects.some((s) => /budget_item_appointments|"BudgetItemAppointment"/i.test(s))).toBe(true)

      const writes = spy.statements.filter((s) =>
        /^\s*(insert|update|delete|truncate|alter|drop|create|upsert|merge|grant)\b/i.test(s)
      )
      expect(writes).toEqual([])

      const after = await snapshot()
      expect(after.counts).toEqual(before.counts)
      expect(after.content).toBe(before.content)
    })

    it('the SQL spy and content fingerprint do see an UPDATE (they are not blind)', async () => {
      const appt = await prisma.appointment.findFirst({ where: { tenantId, cost: { not: null } } })
      const before = await snapshot()
      const spy = spyOnSql()
      try {
        await prisma.appointment.update({ where: { id: appt!.id }, data: { notes: `touched-${suffix}` } })
      } finally {
        spy.restore()
      }
      expect(spy.statements.some((s) => /^\s*update\b/i.test(s))).toBe(true)
      const after = await snapshot()
      // Row counts are jointly blind to an UPDATE; the content fingerprint is not.
      expect(after.counts).toEqual(before.counts)
      expect(after.content).not.toBe(before.content)
      await prisma.appointment.update({ where: { id: appt!.id }, data: { notes: appt!.notes } })
    })
  })

  // ==========================================================================
  // Language guard
  // ==========================================================================
  describe('formatReport language', () => {
    // Reworded for task #590. The framing this test guards MOVED: before #590
    // the banner said a double charge was "possible, not certain", because the
    // engine billed both figures. #590 made the appointment's cost the only
    // charge for its visit, so that sentence became a false statement on
    // screen. The rows are still "overlaps to review" and still name nothing a
    // duplicate and total no amount overcharged — what the banner now states
    // is that the executed items no longer bill on their own, which is pinned
    // below so a revert to the old prose cannot pass unnoticed.
    it('frames rows as overlaps to review, states that the items no longer bill on their own, and still names no duplicate or amount owed', async () => {
      const text = formatReport(await report())
      expect(text).toContain('overlaps to review')
      expect(text).toContain('Read-only report: nothing was modified.')
      expect(text).toContain('no longer bill on their own')

      // The banned-word scan runs on a synthetic report, never on `text`: the real one embeds the
      // clinic's data (status enums such as CONFIRMED, clinician-typed descriptions), so a
      // CONFIRMED appointment would fail a correct script. The constraint is on the script's own
      // wording; the synthetic statuses and description below contain none of the banned words.
      const synthetic = formatReport({
        appointmentCount: 1,
        tenants: [
          {
            tenantId: 'tenant-synthetic',
            patients: [
              {
                patientId: 'patient-synthetic',
                appointments: [
                  {
                    appointmentId: 'appt-synthetic',
                    startTime: new Date('2031-01-02T10:00:00.000Z'),
                    appointmentStatus: 'DONE',
                    typedCost: '150.00',
                    executedItemsSubtotal: '100.00',
                    executedItems: [
                      {
                        budgetItemId: 'item-synthetic',
                        budgetId: 'budget-synthetic',
                        description: 'neutral description',
                        toothNumber: '16',
                        totalPrice: '100.00',
                        itemStatus: 'DONE',
                        budgetStatus: 'DONE',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
      expect(synthetic).toContain('overlaps to review')
      expect(synthetic).toContain('no longer bill on their own')
      // The empty-report early return prints its own prose and is reached by neither string
      // above, so it needs the scan too: banned words planted in it went unnoticed otherwise.
      const empty = formatReport({ tenants: [], appointmentCount: 0 })
      for (const banned of ['duplicate', 'confirmed', 'overcharge', 'owed', 'refund', 'grand total']) {
        expect(synthetic.toLowerCase()).not.toContain(banned)
        expect(empty.toLowerCase()).not.toContain(banned)
      }
      // Only per-appointment figures are printed: no line is a cross-appointment money total.
      const moneyLines = text
        .split('\n')
        .filter((l) => /\d+\.\d{2}/.test(l) && !/Typed cost on the appointment|Executed items subtotal|^\s+- item /.test(l))
      expect(moneyLines).toEqual([])
    })

    it('prints a plain empty message when there is nothing to review', () => {
      const text = formatReport({ tenants: [], appointmentCount: 0 })
      expect(text).toContain('overlaps to review')
      expect(text).toContain('No overlaps found.')
    })

    it('never selects patient names: the output has ids only', async () => {
      const text = formatReport(await report())
      const json = JSON.stringify(await report())
      for (const out of [text, json]) {
        expect(out).not.toContain('fixture-one')
        expect(out).not.toContain('fixture-two')
      }
    })
  })

  // ==========================================================================
  // parseArgs and the CLI
  // ==========================================================================
  describe('parseArgs', () => {
    it('defaults to no tenant, no limit, text output', () => {
      expect(parseArgs([])).toEqual({ tenantId: undefined, limit: undefined, json: false })
    })

    it('parses --tenant=, --limit= and --json together', () => {
      expect(parseArgs(['--tenant=abc123', '--limit=50', '--json'])).toEqual({
        tenantId: 'abc123',
        limit: 50,
        json: true,
      })
    })

    it.each(['--limit=0', '--limit=-3', '--limit=2.5', '--limit=abc', '--limit='])(
      'rejects %s',
      (arg) => {
        expect(() => parseArgs([arg])).toThrow(`Invalid --limit: ${arg}`)
      }
    )

    it.each(['--apply', '--dry-run', '--tenant', '--bogus=1', 'positional'])(
      'rejects the unknown argument %s (there is no mutating or dry-run mode)',
      (arg) => {
        expect(() => parseArgs([arg])).toThrow(`Unknown argument: ${arg}`)
      }
    )
  })

  describe('CLI entrypoint', () => {
    const tsx = resolve(API_ROOT, 'node_modules/.bin/tsx')
    const script = resolve(API_ROOT, 'src/scripts/report-cost-budget-overlap.ts')

    async function run(args: string[]) {
      try {
        const { stdout, stderr } = await execFileAsync(tsx, [script, ...args], {
          cwd: API_ROOT,
          env: process.env,
        })
        return { code: 0, stdout, stderr }
      } catch (e) {
        const err = e as { code: number; stdout: string; stderr: string }
        return { code: err.code, stdout: err.stdout, stderr: err.stderr }
      }
    }

    it('exits 1 with a clear message on an unknown argument and prints no report', async () => {
      const r = await run(['--apply'])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Unknown argument: --apply')
      expect(r.stdout).toBe('')
    }, 60_000)

    it('exits 1 on an invalid --limit', async () => {
      const r = await run(['--limit=0'])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Invalid --limit: --limit=0')
    }, 60_000)

    it('runs end to end against the database and emits the JSON for a tenant', async () => {
      const r = await run([`--tenant=${tenantId}`, '--json'])
      expect(r.code).toBe(0)
      const parsed = JSON.parse(r.stdout) as CostBudgetOverlapReport
      expect(parsed.tenants.map((t) => t.tenantId)).toEqual([tenantId])
      expect(parsed.appointmentCount).toBe((await report()).appointmentCount)
    }, 60_000)
  })
})
