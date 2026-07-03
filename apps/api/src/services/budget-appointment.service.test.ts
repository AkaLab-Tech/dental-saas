import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'
import {
  setAppointmentBudgetItems,
  confirmExecutedBudgetItems,
  getAppointmentBudgetItems,
} from './budget-appointment.service.js'

describe('budget-appointment.service', () => {
  let tenantId: string
  let otherTenantId: string
  let patientId: string
  let otherPatientId: string
  let doctorId: string
  let otherDoctorId: string
  let appointmentId: string
  let otherAppointmentId: string
  const suffix = Date.now()
  const userId = 'svc-test-user'

  async function makeTenant(name: string, slug: string): Promise<string> {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: {
          name: 'free',
          displayName: 'Free',
          price: 0,
          maxAdmins: 1,
          maxDoctors: 3,
          maxPatients: 50,
        },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name, slug, currency: 'USD', timezone: 'America/New_York' },
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
    return tenant.id
  }

  beforeAll(async () => {
    tenantId = await makeTenant('Budget-Appt Service Clinic', `budget-appt-svc-${suffix}`)
    otherTenantId = await makeTenant('Other Budget-Appt Clinic', `other-budget-appt-svc-${suffix}`)

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Svc', lastName: 'Patient' },
    })
    patientId = patient.id
    const otherPatient = await prisma.patient.create({
      data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Patient' },
    })
    otherPatientId = otherPatient.id

    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Svc', lastName: 'Doctor', email: `svc-doc-${suffix}@test.com` },
    })
    doctorId = doctor.id
    const otherDoctor = await prisma.doctor.create({
      data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Doctor', email: `other-doc-${suffix}@test.com` },
    })
    otherDoctorId = otherDoctor.id
  })

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.budgetItem.deleteMany({ where: { budget: { tenantId: { in: [tenantId, otherTenantId] } } } })
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.doctor.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  beforeEach(async () => {
    // budgetItemAppointment rows cascade-delete with their appointment
    await prisma.appointment.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.budgetItem.deleteMany({ where: { budget: { tenantId: { in: [tenantId, otherTenantId] } } } })
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    const appt = await prisma.appointment.create({
      data: { tenantId, patientId, doctorId, startTime: start, endTime: end, duration: 30 },
    })
    appointmentId = appt.id

    const otherAppt = await prisma.appointment.create({
      data: {
        tenantId: otherTenantId,
        patientId: otherPatientId,
        doctorId: otherDoctorId,
        startTime: start,
        endTime: end,
        duration: 30,
      },
    })
    otherAppointmentId = otherAppt.id
  })

  /** Create a fresh APPROVED budget with one item in the given status, in the given tenant. */
  async function makeBudgetItem(
    status: 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'EXECUTED' | 'CANCELLED' = 'PENDING',
    tId = tenantId,
    pId = patientId,
    unitPrice = 300
  ) {
    const budget = await prisma.budget.create({
      data: { tenantId: tId, patientId: pId, status: 'APPROVED' },
    })
    const item = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: 'Root canal',
        quantity: 1,
        unitPrice,
        totalPrice: unitPrice,
        status,
        order: 0,
      },
    })
    return { budgetId: budget.id, itemId: item.id }
  }

  // ==========================================================================
  // setAppointmentBudgetItems
  // ==========================================================================

  describe('setAppointmentBudgetItems', () => {
    it('returns APPOINTMENT_NOT_FOUND for an unknown appointment id', async () => {
      const result = await setAppointmentBudgetItems(tenantId, 'does-not-exist', [], userId)
      expect(result).toEqual({ success: false, code: 'APPOINTMENT_NOT_FOUND' })
    })

    it('returns APPOINTMENT_NOT_FOUND when the appointment belongs to another tenant', async () => {
      const result = await setAppointmentBudgetItems(tenantId, otherAppointmentId, [], userId)
      expect(result).toEqual({ success: false, code: 'APPOINTMENT_NOT_FOUND' })
    })

    it('links a PENDING item, promotes it to SCHEDULED, and creates a role=SCHEDULED join row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe(itemId)
      expect(result.data[0].status).toBe('SCHEDULED')
      expect(result.data[0].roles).toEqual(['SCHEDULED'])

      const item = await prisma.budgetItem.findUnique({ where: { id: itemId } })
      expect(item?.status).toBe('SCHEDULED')

      const links = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: itemId, appointmentId },
      })
      expect(links).toHaveLength(1)
      expect(links[0].role).toBe('SCHEDULED')
      expect(links[0].createdById).toBe(userId)
    })

    it('is idempotent: calling twice with the same id creates exactly one SCHEDULED join row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')

      const first = await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)
      const second = await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(first.success).toBe(true)
      expect(second.success).toBe(true)

      const links = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: itemId, appointmentId, role: 'SCHEDULED' },
      })
      expect(links).toHaveLength(1)
    })

    it('rejects an EXECUTED item with ITEM_NOT_ELIGIBLE', async () => {
      const { itemId } = await makeBudgetItem('EXECUTED')

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_ELIGIBLE' })
    })

    it('rejects a CANCELLED item with ITEM_NOT_ELIGIBLE', async () => {
      const { itemId } = await makeBudgetItem('CANCELLED')

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_ELIGIBLE' })
    })

    it('rejects an unknown item id with ITEM_NOT_FOUND', async () => {
      const result = await setAppointmentBudgetItems(tenantId, appointmentId, ['nope'], userId)
      expect(result).toEqual({ success: false, code: 'ITEM_NOT_FOUND' })
    })

    it('rejects an item belonging to another tenant with ITEM_NOT_FOUND (tenant scoping)', async () => {
      const { itemId: otherItemId } = await makeBudgetItem('PENDING', otherTenantId, otherPatientId)

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [otherItemId], userId)

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_FOUND' })
    })

    it('rolls back the whole batch when one id in a multi-item add is ineligible', async () => {
      const { itemId: validId } = await makeBudgetItem('PENDING')
      const { itemId: ineligibleId } = await makeBudgetItem('EXECUTED')

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [validId, ineligibleId], userId)

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_ELIGIBLE' })

      // The valid id must NOT have been partially linked — the transaction rolled back.
      const validItem = await prisma.budgetItem.findUnique({ where: { id: validId } })
      expect(validItem?.status).toBe('PENDING')
      const links = await prisma.budgetItemAppointment.findMany({ where: { budgetItemId: validId } })
      expect(links).toHaveLength(0)
    })

    it('unlinking reverts a SCHEDULED item to PENDING and deletes the SCHEDULED join row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [], userId)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data).toHaveLength(0)

      const item = await prisma.budgetItem.findUnique({ where: { id: itemId } })
      expect(item?.status).toBe('PENDING')
      const links = await prisma.budgetItemAppointment.findMany({ where: { budgetItemId: itemId } })
      expect(links).toHaveLength(0)
    })

    it('does NOT revert an item that already holds an EXECUTED join row elsewhere', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)
      const confirmed = await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)
      expect(confirmed.success).toBe(true)

      // Unassociate: removes the SCHEDULED join row only.
      const result = await setAppointmentBudgetItems(tenantId, appointmentId, [], userId)
      expect(result.success).toBe(true)

      const item = await prisma.budgetItem.findUnique({ where: { id: itemId } })
      expect(item?.status).toBe('EXECUTED')

      const links = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: itemId, appointmentId },
      })
      expect(links.map((l) => l.role)).toEqual(['EXECUTED'])
    })

    it('recalculates the affected budget totalAmount after linking', async () => {
      const { budgetId, itemId } = await makeBudgetItem('PENDING', tenantId, patientId, 300)

      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      const budget = await prisma.budget.findUnique({ where: { id: budgetId } })
      expect(budget?.totalAmount.toNumber()).toBe(300)
    })
  })

  // ==========================================================================
  // confirmExecutedBudgetItems
  // ==========================================================================

  describe('confirmExecutedBudgetItems', () => {
    it('returns APPOINTMENT_NOT_FOUND for an unknown appointment id', async () => {
      const result = await confirmExecutedBudgetItems(tenantId, 'does-not-exist', [], userId)
      expect(result).toEqual({ success: false, code: 'APPOINTMENT_NOT_FOUND' })
    })

    it('returns success with no changes for an empty id list', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      const result = await confirmExecutedBudgetItems(tenantId, appointmentId, [], userId)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data[0].status).toBe('SCHEDULED')
      expect(result.data[0].roles).toEqual(['SCHEDULED'])
    })

    it('confirms a SCHEDULED-linked item as EXECUTED, keeping the SCHEDULED join row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      const result = await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data[0].status).toBe('EXECUTED')
      expect(result.data[0].roles.slice().sort()).toEqual(['EXECUTED', 'SCHEDULED'])

      const item = await prisma.budgetItem.findUnique({ where: { id: itemId } })
      expect(item?.status).toBe('EXECUTED')
    })

    it('leaves items not listed as SCHEDULED (no auto-execution of the rest)', async () => {
      const { itemId: itemA, budgetId } = await makeBudgetItem('PENDING')
      const itemB = await prisma.budgetItem.create({
        data: {
          budgetId,
          description: 'Filling',
          quantity: 1,
          unitPrice: 50,
          totalPrice: 50,
          status: 'PENDING',
          order: 1,
        },
      })
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemA, itemB.id], userId)

      const result = await confirmExecutedBudgetItems(tenantId, appointmentId, [itemA], userId)

      expect(result.success).toBe(true)
      const bStatus = await prisma.budgetItem.findUnique({ where: { id: itemB.id } })
      expect(bStatus?.status).toBe('SCHEDULED')
    })

    it('is idempotent: confirming the same id twice does not duplicate the EXECUTED join row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)

      await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)
      await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)

      const links = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: itemId, appointmentId, role: 'EXECUTED' },
      })
      expect(links).toHaveLength(1)
    })

    it('rejects an id not currently SCHEDULED-linked to this appointment with ITEM_NOT_ASSOCIATED', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      // Never associated to appointmentId.

      const result = await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_ASSOCIATED' })
    })

    it('rolls back the whole batch when one id is not associated — the associated id stays SCHEDULED', async () => {
      const { itemId: associatedId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [associatedId], userId)
      const { itemId: unassociatedId } = await makeBudgetItem('PENDING')

      const result = await confirmExecutedBudgetItems(
        tenantId,
        appointmentId,
        [associatedId, unassociatedId],
        userId
      )

      expect(result).toEqual({ success: false, code: 'ITEM_NOT_ASSOCIATED' })

      const associatedItem = await prisma.budgetItem.findUnique({ where: { id: associatedId } })
      expect(associatedItem?.status).toBe('SCHEDULED')
      const executedLinks = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: associatedId, role: 'EXECUTED' },
      })
      expect(executedLinks).toHaveLength(0)
    })
  })

  // ==========================================================================
  // getAppointmentBudgetItems
  // ==========================================================================

  describe('getAppointmentBudgetItems', () => {
    it('returns APPOINTMENT_NOT_FOUND for an appointment in another tenant', async () => {
      const result = await getAppointmentBudgetItems(tenantId, otherAppointmentId)
      expect(result).toEqual({ success: false, code: 'APPOINTMENT_NOT_FOUND' })
    })

    it('returns an empty array for an appointment with no associations', async () => {
      const result = await getAppointmentBudgetItems(tenantId, appointmentId)
      expect(result).toEqual({ success: true, data: [] })
    })

    it('groups both roles under one entry when an item holds a SCHEDULED and an EXECUTED row', async () => {
      const { itemId } = await makeBudgetItem('PENDING')
      await setAppointmentBudgetItems(tenantId, appointmentId, [itemId], userId)
      await confirmExecutedBudgetItems(tenantId, appointmentId, [itemId], userId)

      const result = await getAppointmentBudgetItems(tenantId, appointmentId)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe(itemId)
      expect(result.data[0].roles.slice().sort()).toEqual(['EXECUTED', 'SCHEDULED'])
    })
  })
})
