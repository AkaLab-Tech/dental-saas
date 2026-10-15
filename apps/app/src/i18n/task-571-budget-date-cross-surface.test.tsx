/**
 * Task #571 GUARD 1: a budget's date renders in the APP's language, and the
 * three surfaces that print it agree with each other.
 *
 * Shape copied from the repo's existing two-worlds exemplar
 * (pages/admin/AdminTenantsPage.test.tsx, `describe('date localization')`):
 * render -> assert under `es` -> `switchLocale('en')` -> assert under `en` ->
 * assert the two differ. The last step is what stops the test passing
 * vacuously if both locales happened to format identically.
 *
 * What is varied is `i18n.language`, NOT the browser locale: a surface
 * hardcoded to 'es-ES' would pass a browser-locale test while being wrong for
 * every user whose app language is en or ar.
 *
 * Cross-surface: three components render the same instant for the same budget
 * — the payment form's picker (`budgets.createdOn`), the account statement's
 * held-advance row (`payments.statement.heldForBudget`) and the budget card
 * (`budgets.createdOn`). PaymentFormModal and AccountStatement call the shared
 * `lib/format.ts#formatShortDate`; BudgetCard still holds a private copy (its
 * dedupe is a separate follow-up). The guard is that the three strings stay
 * EQUAL and move TOGETHER, so an independent format in any one of them is
 * visible as a disagreement.
 *
 * `switchLocale` is defined locally on purpose: there are nine such local
 * definitions in this app at e3c3ecb, which is the convention here.
 *
 * No real patient data: synthetic ids and figures only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import i18n from 'i18next'
import '@/i18n'
import { PaymentFormModal } from '@/components/payments/PaymentFormModal'
import { AccountStatement } from '@/components/payments/AccountStatement'
import { BudgetCard } from '@/components/budgets/BudgetCard'
import { formatCurrency } from '@/lib/format'
import type { Budget } from '@/lib/budget-api'
import type { AccountStatement as AccountStatementData } from '@/lib/payment-api'

const BUDGET_ID = 'budget-571'
const PATIENT_ID = 'patient-571'
/** Midday UTC, so the calendar day is the same in every realistic host TZ. */
const CREATED_AT = '2026-04-23T12:00:00Z'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

const net = vi.hoisted(() => ({
  budgets: (() => ({ status: 200, body: { success: true, data: [] } })) as () => {
    status: number
    body: unknown
  },
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const { default: axios } = await import('axios')
  const apiClient = axios.create({
    baseURL: '/api',
    adapter: async (config: InternalAxiosRequestConfig) => {
      const reply = net.budgets()
      return {
        data: reply.body,
        status: reply.status,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse
    },
  })
  return { ...actual, apiClient }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canAny: () => false, canAll: () => false }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: vi.fn(),
  downloadPatientBudgetsPdf: vi.fn(),
}))

function makeBudget(): Budget {
  return {
    id: BUDGET_ID,
    tenantId: 'tenant-571',
    patientId: PATIENT_ID,
    createdById: null,
    status: 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '250.00',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    items: [],
  }
}

function makeStatement(): AccountStatementData {
  return {
    appointmentsDebt: 0,
    advancesCredit: 0,
    remainingBudgetProjection: 0,
    totalBilled: 0,
    totalPaid: 22500,
    advancesTotal: 22500,
    advancesHeld: 17000,
    reservedAdvances: [
      { budgetId: BUDGET_ID, reserved: 22500, consumed: 5500, remaining: 17000, open: true },
    ],
  }
}

const fmt = (amount: number) => formatCurrency(amount, 'USD')

function renderAllThreeSurfaces() {
  net.budgets = () => ({
    status: 200,
    body: { success: true, data: [makeBudget()], pagination: { total: 1 } },
  })
  return render(
    <MemoryRouter>
      <div data-testid="surface-statement">
        <AccountStatement
          statement={makeStatement()}
          formatCurrency={fmt}
          budgetCreatedAt={{ [BUDGET_ID]: CREATED_AT }}
        />
      </div>
      <div data-testid="surface-card">
        <BudgetCard budget={makeBudget()} patientId={PATIENT_ID} onDelete={vi.fn()} />
      </div>
      <div data-testid="surface-picker">
        <PaymentFormModal
          isOpen
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
          patientId={PATIENT_ID}
          formatCurrency={fmt}
        />
      </div>
    </MemoryRouter>
  )
}

/**
 * The date each surface actually printed, pulled out of its own template:
 *   picker:    "Creado el <date> - USD 250.00"
 *   statement: "Presupuesto del <date>: USD 170.00"
 *   card:      "Creado el <date>"
 * Extracted from the rendered text (not recomputed), so an equality between
 * two surfaces is an observation about the DOM.
 */
function datesOnScreen(): { picker: string; statement: string; card: string } {
  const select = within(screen.getByTestId('surface-picker')).getByLabelText(
    /presupuesto|budget|ميزانية/i
  ) as HTMLSelectElement
  const option = Array.from(select.options).find((o) => o.value === BUDGET_ID)
  if (!option) throw new Error('the picker did not offer the budget')
  const amount = fmt(250)
  const pickerText = (option.textContent ?? '').trim()
  const picker = pickerText.slice(0, pickerText.length - ` - ${amount}`.length).trim()

  const statement = (
    within(screen.getByTestId('surface-statement')).getByTestId('statement-held-budget-row')
      .textContent ?? ''
  ).trim()

  const card = (
    within(screen.getByTestId('surface-card')).getByText(/2026/).textContent ?? ''
  ).trim()

  return { picker, statement, card }
}

const MARK = '\u0001'

/**
 * The date a rendered string carries, cut out using that string's OWN i18n
 * template (never a regex over digits: "Created on Apr 23, 2026" would lose
 * the month name, and that silently weakened an earlier draft of this guard).
 */
function dateFromTemplate(
  rendered: string,
  key: string,
  extra: Record<string, string> = {}
): string {
  const template = i18n.t(key, { date: MARK, ...extra })
  const at = template.indexOf(MARK)
  if (at < 0) throw new Error(`${key} does not interpolate {{date}}`)
  const before = template.slice(0, at)
  const after = template.slice(at + MARK.length)
  if (!rendered.startsWith(before) || !rendered.endsWith(after)) {
    throw new Error(`"${rendered}" does not match the ${key} template "${template}"`)
  }
  return rendered.slice(before.length, rendered.length - after.length).trim()
}

const pickerDate = (surfaces: { picker: string }) =>
  dateFromTemplate(surfaces.picker, 'budgets.createdOn')
const cardDate = (surfaces: { card: string }) =>
  dateFromTemplate(surfaces.card, 'budgets.createdOn')
const statementDate = (surfaces: { statement: string }) =>
  dateFromTemplate(surfaces.statement, 'payments.statement.heldForBudget', {
    amount: fmt(17000),
  })

const expectedFor = (locale: string) =>
  new Date(CREATED_AT).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

describe('Task #571 GUARD 1: the budget date follows the app language, on every surface', () => {
  it('es then en: all three surfaces print the same date, and all three move together', async () => {
    renderAllThreeSurfaces()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('surface-picker')).getByLabelText(/presupuesto|budget/i)
      ).toBeInTheDocument()
    )

    const es = datesOnScreen()
    const esDate = pickerDate(es)
    // The format is the app language's, not the browser's: 'es' gives
    // "23 abr 2026" where 'en' gives "Apr 23, 2026".
    expect(esDate).toBe(expectedFor('es'))
    // Cross-surface: the three strings carry the SAME date.
    expect(statementDate(es)).toBe(esDate)
    expect(cardDate(es)).toBe(esDate)

    await switchLocale('en')

    const en = datesOnScreen()
    const enDate = pickerDate(en)
    expect(enDate).toBe(expectedFor('en'))
    expect(statementDate(en)).toBe(enDate)
    expect(cardDate(en)).toBe(enDate)

    // Without this the whole test would pass vacuously if es and en formatted
    // the same instant identically.
    expect(esDate).not.toBe(enDate)
  })

  it('ar: the three surfaces agree there too, and differ from es', async () => {
    renderAllThreeSurfaces()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('surface-picker')).getByLabelText(/presupuesto|budget/i)
      ).toBeInTheDocument()
    )
    const esDate = pickerDate(datesOnScreen())

    await switchLocale('ar')

    const ar = datesOnScreen()
    const arDate = pickerDate(ar)
    expect(arDate).toBe(expectedFor('ar'))
    expect(statementDate(ar)).toBe(arDate)
    expect(cardDate(ar)).toBe(arDate)
    expect(arDate).not.toBe(esDate)

    await switchLocale('es')
  })

  it('the prose around the date is translated too, not only the number', async () => {
    renderAllThreeSurfaces()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('surface-picker')).getByLabelText(/presupuesto|budget/i)
      ).toBeInTheDocument()
    )

    expect(datesOnScreen().picker).toMatch(/^Creado el /)
    expect(datesOnScreen().statement).toMatch(/^Presupuesto del /)

    await switchLocale('en')

    expect(datesOnScreen().picker).toMatch(/^Created on /)
    expect(datesOnScreen().statement).toMatch(/^Budget of /)
  })
})

describe('Task #571: the new keys resolve in all three languages', () => {
  const keys = [
    'payments.statement.heldAdvances',
    'payments.statement.heldForBudget',
    'payments.statement.heldForUnnamedBudget',
    'payments.form.budgetNoneExist',
    'payments.form.budgetAllClosed',
  ]

  it('es, en and ar each return a real string (never the key back)', async () => {
    for (const locale of ['es', 'en', 'ar']) {
      await switchLocale(locale)
      for (const key of keys) {
        const value = i18n.t(key, { date: '23 abr 2026', amount: 'USD 170.00' })
        expect(value, `${key} in ${locale}`).not.toBe(key)
        expect(value.length, `${key} in ${locale}`).toBeGreaterThan(0)
      }
    }
    await switchLocale('es')
  })

  it('the interpolated keys really consume their placeholders', async () => {
    await switchLocale('es')
    expect(i18n.t('payments.statement.heldForBudget', { date: '23 abr 2026', amount: 'USD 170.00' })).toBe(
      'Presupuesto del 23 abr 2026: USD 170.00'
    )
    expect(i18n.t('payments.statement.heldForUnnamedBudget', { amount: 'USD 170.00' })).toBe(
      'Presupuesto reservado: USD 170.00'
    )
  })
})
