/**
 * #541 — one PDF for the whole treatment plan.
 *
 * Runs against the real database on purpose. The two decisions this document
 * rests on are both WHERE clauses, and a mocked `prisma` applies no WHERE
 * clause at all: a unit test with a stubbed `findMany` would pass with either
 * filter and would therefore be evidence of nothing. These are integration
 * tests of `getPatientBudgetsPdfData` plus the rendered bytes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import React from 'react'
import { prisma } from '@dental/database'
import { PdfService } from './pdf.service.js'
import { PatientTreatmentPlanPdf } from '../pdfs/PatientTreatmentPlanPdf.js'
import { pdfText, pdfTextFlat, pdfPageCount } from '../test/pdf-text.js'

/**
 * The clinic's real shape, taken from the production record in #541: nine
 * budgets of ONE item each, every one of them DRAFT, totalling 22.500.
 * Treatment labels are the clinic's; the patient is invented.
 */
const PLAN: { description: string; tooth: string | null; amount: number }[] = [
  { description: 'Extraccion (36, 38)', tooth: '36', amount: 4000 },
  { description: 'Dyp 2da', tooth: null, amount: 1500 },
  { description: 'Dyp 1era', tooth: null, amount: 1500 },
  { description: 'CO (18)', tooth: '18', amount: 2500 },
  { description: 'CP (22)', tooth: '22', amount: 2500 },
  { description: 'CV (37)', tooth: '37', amount: 2500 },
  { description: 'Extraccion (26, 27)', tooth: '26', amount: 4000 },
  { description: 'Extraccion (44, 48)', tooth: '44', amount: 2500 },
  { description: 'Consulta y plan', tooth: null, amount: 1500 },
]
const PLAN_TOTAL = 22500

describe('#541 PdfService.getPatientBudgetsPdfData', () => {
  let tenantId: string
  let otherTenantId: string
  let ninePatientId: string
  let onePatientId: string
  let otherTenantPatientId: string
  const slug = `test-clinic-plan-pdf-${Date.now()}`

  /** One DRAFT budget holding exactly one item, the way the clinic enters them. */
  async function createSingleItemBudget(
    patientId: string,
    item: { description: string; tooth: string | null; amount: number },
    overrides: {
      budgetStatus?: 'DRAFT' | 'APPROVED' | 'CANCELLED'
      itemStatus?: 'PENDING' | 'EXECUTED' | 'CANCELLED'
      isActive?: boolean
      tenant?: string
    } = {}
  ) {
    return prisma.budget.create({
      data: {
        tenantId: overrides.tenant ?? tenantId,
        patientId,
        status: overrides.budgetStatus ?? 'DRAFT',
        isActive: overrides.isActive ?? true,
        totalAmount: item.amount,
        items: {
          create: [
            {
              description: item.description,
              toothNumber: item.tooth,
              quantity: 1,
              unitPrice: item.amount,
              totalPrice: item.amount,
              status: overrides.itemStatus ?? 'PENDING',
            },
          ],
        },
      },
    })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Treatment Plan', slug, currency: 'UYU' },
    })
    tenantId = tenant.id
    const other = await prisma.tenant.create({
      data: { name: 'Other Clinic Treatment Plan', slug: `${slug}-other` },
    })
    otherTenantId = other.id

    const nine = await prisma.patient.create({
      data: { tenantId, firstName: 'Nueve', lastName: 'Presupuestos' },
    })
    ninePatientId = nine.id
    const one = await prisma.patient.create({
      data: { tenantId, firstName: 'Uno', lastName: 'Presupuesto' },
    })
    onePatientId = one.id
    const foreign = await prisma.patient.create({
      data: { tenantId: otherTenantId, firstName: 'Ajeno', lastName: 'Inquilino' },
    })
    otherTenantPatientId = foreign.id

    // Sequentially, so budget.createdAt ordering is the entry order.
    for (const item of PLAN) {
      await createSingleItemBudget(ninePatientId, item)
    }
    await createSingleItemBudget(onePatientId, {
      description: 'Protesis removible',
      tooth: null,
      amount: 7800,
    })
  })

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  /** Unwraps the result or fails loudly instead of leaking `undefined` into assertions. */
  async function planFor(patientId: string, tenant = tenantId) {
    const result = await PdfService.getPatientBudgetsPdfData(tenant, patientId)
    if ('error' in result) {
      throw new Error(`expected plan data, got ${result.error}: ${result.message}`)
    }
    return result.data
  }

  describe('the budget-level filter includes DRAFT', () => {
    it('lists all nine DRAFT single-item budgets as nine rows totalling 22500', async () => {
      const data = await planFor(ninePatientId)

      expect(data.items.map((i) => i.description)).toEqual(PLAN.map((p) => p.description))
      expect(data.items).toHaveLength(9)
      expect(Number(data.totalAmount)).toBe(PLAN_TOTAL)
    })

    it('each row carries its own unit price, line total and tooth', async () => {
      const data = await planFor(ninePatientId)

      expect(
        data.items.map((i) => ({
          description: i.description,
          tooth: i.toothNumber,
          quantity: i.quantity,
          unit: Number(i.unitPrice),
          line: Number(i.totalPrice),
        }))
      ).toEqual(
        PLAN.map((p) => ({
          description: p.description,
          tooth: p.tooth,
          quantity: 1,
          unit: p.amount,
          line: p.amount,
        }))
      )
    })

    it('the printed total is the sum of the rows above it, not a budget field', async () => {
      // Every budget's stored totalAmount is deliberately wrong here; the
      // document must still add up to what it prints.
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Total', lastName: 'Desalineado' },
      })
      const budget = await createSingleItemBudget(
        patient.id,
        { description: 'Endodoncia', tooth: '11', amount: 3300 },
        // APPROVED, not DRAFT: this test is about where the total comes from,
        // so it must not also fall when the budget-status filter is broken.
        { budgetStatus: 'APPROVED' }
      )
      await prisma.budget.update({ where: { id: budget.id }, data: { totalAmount: 99999 } })

      const data = await planFor(patient.id)

      expect(Number(data.totalAmount)).toBe(3300)
      await prisma.budget.deleteMany({ where: { patientId: patient.id } })
      await prisma.patient.delete({ where: { id: patient.id } })
    })
  })

  describe('the item-level filter includes EXECUTED', () => {
    it('keeps an EXECUTED treatment on the patient copy and in the total', async () => {
      // CV (37), 2500: executing it must not remove it from the plan the
      // patient was handed. If it did, the total would read 20000.
      const executed = PLAN[5]
      const row = await prisma.budgetItem.findFirstOrThrow({
        where: { description: executed.description, budget: { patientId: ninePatientId } },
      })
      await prisma.budgetItem.update({ where: { id: row.id }, data: { status: 'EXECUTED' } })
      try {
        const data = await planFor(ninePatientId)

        // One assertion, so a broken item filter reports all three numbers it
        // moves at once: 8 rows, 20000, and the treatment gone.
        expect({
          rows: data.items.length,
          total: Number(data.totalAmount),
          keepsExecutedTreatment: data.items.some((i) => i.description === executed.description),
        }).toEqual({ rows: 9, total: PLAN_TOTAL, keepsExecutedTreatment: true })
      } finally {
        await prisma.budgetItem.update({ where: { id: row.id }, data: { status: 'PENDING' } })
      }
    })

    it('keeps an EXECUTED item of an APPROVED budget too', async () => {
      // Same decision as above, on a fixture that does not depend on DRAFT
      // being included: breaking the budget filter must not drop this one.
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Ejecutado', lastName: 'Aprobado' },
      })
      await createSingleItemBudget(
        patient.id,
        { description: 'Corona ejecutada', tooth: '46', amount: 5200 },
        { budgetStatus: 'APPROVED', itemStatus: 'EXECUTED' }
      )

      const data = await planFor(patient.id)

      expect(data.items.map((i) => i.description)).toEqual(['Corona ejecutada'])
      expect(Number(data.totalAmount)).toBe(5200)

      await prisma.budget.deleteMany({ where: { patientId: patient.id } })
      await prisma.patient.delete({ where: { id: patient.id } })
    })
  })

  describe('what is excluded', () => {
    it('leaves out a CANCELLED budget, a CANCELLED item and an inactive budget', async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Excluidos', lastName: 'Varios' },
      })
      await createSingleItemBudget(
        patient.id,
        { description: 'Visible pendiente', tooth: null, amount: 1000 },
        // APPROVED on purpose: the subject here is what gets EXCLUDED, so the
        // one visible row must survive a break in the DRAFT decision.
        { budgetStatus: 'APPROVED' }
      )
      await createSingleItemBudget(
        patient.id,
        { description: 'Presupuesto cancelado', tooth: null, amount: 2000 },
        { budgetStatus: 'CANCELLED' }
      )
      await createSingleItemBudget(
        patient.id,
        { description: 'Item cancelado', tooth: null, amount: 4000 },
        { itemStatus: 'CANCELLED', budgetStatus: 'APPROVED' }
      )
      await createSingleItemBudget(
        patient.id,
        { description: 'Presupuesto inactivo', tooth: null, amount: 8000 },
        { isActive: false, budgetStatus: 'APPROVED' }
      )

      const data = await planFor(patient.id)

      expect(data.items.map((i) => i.description)).toEqual(['Visible pendiente'])
      expect(Number(data.totalAmount)).toBe(1000)

      await prisma.budget.deleteMany({ where: { patientId: patient.id } })
      await prisma.patient.delete({ where: { id: patient.id } })
    })

    it("never reaches another tenant's patient", async () => {
      const result = await PdfService.getPatientBudgetsPdfData(tenantId, otherTenantPatientId)
      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Patient not found' })
    })

    it('reports NOT_FOUND for an unknown patient id', async () => {
      const result = await PdfService.getPatientBudgetsPdfData(tenantId, 'no-such-patient')
      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Patient not found' })
    })

    it('returns an empty plan, not an error, for a patient with no budgets', async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Sin', lastName: 'Presupuestos' },
      })
      const data = await planFor(patient.id)
      expect(data.items).toEqual([])
      expect(Number(data.totalAmount)).toBe(0)
      await prisma.patient.delete({ where: { id: patient.id } })
    })
  })

  describe('the rendered document', () => {
    it('is exactly ONE page for the nine-budget patient', async () => {
      // The discriminating assertion of #541. Content alone cannot tell this
      // path from the old one: nine per-budget PDFs also contain all nine
      // descriptions, one per file.
      const data = await planFor(ninePatientId)
      const pdf = await PdfService.generatePdf(
        React.createElement(PatientTreatmentPlanPdf, { data })
      )

      expect(pdf.toString('utf8', 0, 5)).toBe('%PDF-')
      expect(pdfPageCount(pdf)).toBe(1)
    })

    it('prints all nine descriptions and the 22500 total on that page', async () => {
      const data = await planFor(ninePatientId)
      const pdf = await PdfService.generatePdf(
        React.createElement(PatientTreatmentPlanPdf, { data })
      )
      const text = pdfTextFlat(pdf)

      for (const { description } of PLAN) {
        expect(text, `"${description}" missing from the rendered plan`).toContain(description)
      }
      expect(text).toContain('UYU 22500')
      expect(text).toContain('Plan de Tratamiento')
    })

    it('prints each of the nine rows exactly once', async () => {
      // The gap the two assertions above leave open, and it is a render gap
      // only: the data layer is already pinned by `toEqual` on the nine
      // descriptions plus `toHaveLength(9)`, so duplication cannot arrive
      // through the query. A template that emitted every row twice onto one
      // page would satisfy all three of them at once — `pdfPageCount` still
      // reads 1, every description is still present to `toContain`, and the
      // 22500 total is derived from the data rather than from the rendered
      // rows, so it does not move either. This is the only assertion that
      // looks at what the template does with rows the data layer has already
      // guaranteed unique.
      const data = await planFor(ninePatientId)
      const pdf = await PdfService.generatePdf(
        React.createElement(PatientTreatmentPlanPdf, { data })
      )
      const text = pdfTextFlat(pdf)

      // No PLAN description is a substring of another, so a plain split counts
      // whole rows.
      const occurrences = (needle: string) => text.split(needle).length - 1

      for (const { description } of PLAN) {
        expect(
          occurrences(description),
          `"${description}" should appear exactly once in the rendered plan`
        ).toBe(1)
      }
    })

    it('prints no budget id', async () => {
      const budgets = await prisma.budget.findMany({
        where: { patientId: ninePatientId },
        select: { id: true },
      })
      const data = await planFor(ninePatientId)
      const pdf = await PdfService.generatePdf(
        React.createElement(PatientTreatmentPlanPdf, { data })
      )
      const text = pdfText(pdf)

      expect(budgets).toHaveLength(9)
      for (const { id } of budgets) {
        expect(text, `budget id ${id} leaked onto the patient's copy`).not.toContain(id)
      }
    })

    it('is the same single-page document for a patient with one budget', async () => {
      const data = await planFor(onePatientId)
      const pdf = await PdfService.generatePdf(
        React.createElement(PatientTreatmentPlanPdf, { data })
      )
      const text = pdfTextFlat(pdf)

      expect(data.items).toHaveLength(1)
      expect(Number(data.totalAmount)).toBe(7800)
      expect(pdfPageCount(pdf)).toBe(1)
      expect(text).toContain('Protesis removible')
      expect(text).toContain('UYU 7800')
    })
  })
})
