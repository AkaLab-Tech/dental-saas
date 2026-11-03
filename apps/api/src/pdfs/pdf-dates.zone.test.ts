import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { PatientHistoryPdf, calculateAge } from './PatientHistoryPdf.js'
import { BudgetPdf } from './BudgetPdf.js'
import { LabworkOrderPdf } from './LabworkOrderPdf.js'
import { AppointmentReceiptPdf } from './AppointmentReceiptPdf.js'
import { PatientTreatmentPlanPdf } from './PatientTreatmentPlanPdf.js'
import { PdfService } from '../services/pdf.service.js'
import type {
  TenantInfo,
  PatientInfo,
  BudgetPdfData,
  LabworkOrderData,
  AppointmentReceiptData,
  PatientTreatmentPlanData,
  PatientHistoryData,
} from '../services/pdf.service.js'

// Task #653. The zone is PINNED per test with vi.stubEnv('TZ', ...), never
// inherited: no vitest config or script in this repo sets TZ.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'

// Every date-valued field gets its OWN day, so an assertion on one field can only be
// satisfied by that field. Calendar days are stored as UTC midnight of the day entered.
const DOB = new Date('1984-05-12T00:00:00.000Z') // 12 mayo 1984 (shifted: 11)
const VALID_UNTIL = new Date('2026-10-28T00:00:00.000Z') // 28 octubre 2026 (shifted: 27)
const LABWORK_DATE = new Date('2026-11-14T00:00:00.000Z') // 14 noviembre 2026 (shifted: 13)
// Instants at 22:30 Montevideo (UTC-3) = 01:30 next day UTC.
const BUDGET_CREATED_AT = new Date('2026-10-21T01:30:00.000Z') // 20 oct MVD, 21 oct UTC
const APPOINTMENT_START = new Date('2026-09-09T01:30:00.000Z') // 8 sep MVD, 9 sep UTC
const ITEM_BUDGET_DATE = new Date('2026-08-19T01:30:00.000Z') // 18 ago MVD, 19 ago UTC
const GENERATED_AT = new Date('2026-12-03T15:00:00.000Z') // 3 dic

async function inZone(zone: string, fn: () => Promise<void> | void) {
  vi.stubEnv('TZ', zone)
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  await fn()
}

function extractText(node: unknown): string[] {
  if (node == null) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(extractText)
  if (React.isValidElement(node) && node.props) {
    const props = node.props as { children?: unknown }
    return extractText(props.children)
  }
  return []
}

afterEach(() => {
  vi.unstubAllEnvs()
})

const mockTenant: TenantInfo = {
  name: 'Clinica Dental Alveo',
  address: 'Av. 18 de Julio 1234',
  phone: '099123456',
  email: 'contacto@alveo.test',
  currency: 'USD',
  timezone: MONTEVIDEO,
  language: 'es',
  logo: null,
}

const mockPatient: PatientInfo = {
  id: 'patient-1',
  firstName: 'Juan',
  lastName: 'Perez',
  email: 'juan@test.com',
  phone: '099111222',
  address: 'Calle Falsa 123',
  dob: DOB,
  gender: 'MALE',
}

describe('Server PDFs calendar-day formatting (#653)', () => {
  describe('PatientHistoryPdf (patient.dob)', () => {
    it.each([MONTEVIDEO, UTC])('renders DOB as 12 de mayo de 1984 in %s', async (zone) => {
      await inZone(zone, async () => {
        const historyData: PatientHistoryData = {
          tenant: mockTenant,
          patient: mockPatient,
          appointments: [],
          teethNotes: null,
          generatedAt: GENERATED_AT,
        }

        const doc = PatientHistoryPdf({ data: historyData })

        const text = extractText(doc).join(' ')
        expect(text).toContain('12 de mayo de 1984')
        expect(text).not.toContain('11 de mayo de 1984')

        // Ensure PDF buffer builds without error
        const buffer = await PdfService.generatePdf(doc)
        expect(buffer.length).toBeGreaterThan(0)
      })
    })
  })

  describe('BudgetPdf (budget.validUntil vs budget.createdAt)', () => {
    const mockBudget: BudgetPdfData['budget'] = {
      id: 'b-1',
      status: 'APPROVED',
      totalAmount: '1500',
      createdAt: BUDGET_CREATED_AT,
      validUntil: VALID_UNTIL,
      notes: 'Tratamiento inicial',
      items: [],
    }

    it.each([MONTEVIDEO, UTC])('renders validUntil as 28 de octubre de 2026 in %s', async (zone) => {
      await inZone(zone, async () => {
        const budgetData: BudgetPdfData = {
          tenant: mockTenant,
          patient: mockPatient,
          budget: mockBudget,
          generatedAt: GENERATED_AT,
        }

        const doc = BudgetPdf({ data: budgetData })

        const text = extractText(doc).join(' ')
        expect(text).toContain('28 de octubre de 2026')
        expect(text).not.toContain('27 de octubre de 2026')

        const buffer = await PdfService.generatePdf(doc)
        expect(buffer.length).toBeGreaterThan(0)
      })
    })
  })

  describe('LabworkOrderPdf (labwork.date)', () => {
    const mockLabwork: LabworkOrderData['labwork'] = {
      id: 'lw-1',
      lab: 'Laboratorio Dental',
      phoneNumber: '099111333',
      date: LABWORK_DATE,
      note: null,
      price: '250',
      isPaid: false,
      isDelivered: false,
    }

    it.each([MONTEVIDEO, UTC])('renders labwork date as 14 de noviembre de 2026 in %s', async (zone) => {
      await inZone(zone, async () => {
        const labworkData: LabworkOrderData = {
          tenant: mockTenant,
          labwork: mockLabwork,
          patient: mockPatient,
          doctors: [{ id: 'd-1', firstName: 'Dra. Maria', lastName: 'Gomez' }],
          generatedAt: GENERATED_AT,
        }

        const doc = LabworkOrderPdf({ data: labworkData })

        const text = extractText(doc).join(' ')
        expect(text).toContain('14 de noviembre de 2026')
        expect(text).not.toContain('13 de noviembre de 2026')

        const buffer = await PdfService.generatePdf(doc)
        expect(buffer.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Verified as out of scope — instant values unchanged (#653)', () => {
    it('AppointmentReceiptPdf renders appointment.startTime in tenant timezone', async () => {
      await inZone(MONTEVIDEO, () => {
        const receiptData: AppointmentReceiptData = {
          tenant: mockTenant,
          appointment: {
            id: 'apt-1',
            startTime: APPOINTMENT_START,
            endTime: new Date('2026-10-29T02:00:00.000Z'),
            duration: 30,
            type: 'Consulta',
            status: 'COMPLETED',
            cost: '100',
            isPaid: true,
            notes: null,
          },
          patient: mockPatient,
          doctor: {
            id: 'd-1',
            firstName: 'Dr.',
            lastName: 'Smith',
            specialty: 'Odontología',
            licenseNumber: '12345',
          },
          generatedAt: GENERATED_AT,
        }

        const doc = AppointmentReceiptPdf({ data: receiptData })

        const text = extractText(doc).join(' ')
        expect(text).toContain('8 de septiembre de 2026')
        expect(text).not.toContain('9 de septiembre de 2026')
      })
    })

    it('PatientTreatmentPlanPdf renders item.budgetDate (createdAt instant) in tenant timezone', async () => {
      await inZone(MONTEVIDEO, () => {
        const planData: PatientTreatmentPlanData = {
          tenant: mockTenant,
          patient: mockPatient,
          items: [
            {
              id: 'item-1',
              description: 'Limpieza',
              toothNumber: null,
              quantity: 1,
              unitPrice: '50',
              totalPrice: '50',
              budgetDate: ITEM_BUDGET_DATE,
            },
          ],
          totalAmount: '50',
          generatedAt: GENERATED_AT,
        }

        const doc = PatientTreatmentPlanPdf({ data: planData })

        const text = extractText(doc).join(' ')
        expect(text).toContain('18 ago 2026')
        expect(text).not.toContain('19 ago 2026')
      })
    })
  })
})

describe('calculateAge uses the tenant day, not the host day (#653)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // dob 12 May 1984; tenant America/Montevideo (UTC-3). The pre-fix host-local version
  // and the UTC-getter version both report 42 at the second instant. The host zone is
  // varied too (UTC and Montevideo), so a version that reads dob through host-local
  // getters is also caught: under a UTC host it is indistinguishable from the right one.
  const CASES: Array<[string, number, string]> = [
    ['2026-05-11T23:30:00Z', 41, '20:30 local, 11 May'],
    ['2026-05-12T00:30:00Z', 41, '21:30 local, still 11 May'],
    ['2026-05-12T03:30:00Z', 42, '00:30 local, 12 May'],
  ]
  // The call site, not just the helper: PatientHistoryPdf must hand calculateAge the
  // TENANT's timezone. At 21:30 on 11 May in Montevideo (00:30Z on 12 May) the printed
  // age is 41; a call site that passed 'UTC' or dropped the argument would print 42.
  it('PatientHistoryPdf prints the age for the tenant day (41, not 42, the evening before the birthday)', async () => {
    await inZone(UTC, () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-12T00:30:00Z'))
      const doc = PatientHistoryPdf({
        data: {
          tenant: mockTenant,
          patient: mockPatient,
          appointments: [],
          teethNotes: null,
          generatedAt: GENERATED_AT,
        },
      })
      const text = extractText(doc).join(' ')
      expect(text).toMatch(/\b41\s+años/)
      expect(text).not.toMatch(/\b42\s+años/)
    })
  })

  describe.each([UTC, MONTEVIDEO])('host zone %s', (hostZone) => {
    it.each(CASES)('at %s the age is %i (%s)', async (now, expected) => {
      await inZone(hostZone, () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(now))
        expect(calculateAge(DOB, MONTEVIDEO)).toBe(expected)
      })
    })
  })
})
