import { readFileSync } from 'fs'
import { resolve } from 'path'
import { expect, type Locator, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from '../global-setup'

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'

/** Worktree-root .task-log (this package's cwd is apps/app). */
export const SHOTS = resolve(process.cwd(), '../../.task-log/screenshots')

/** Raw request: the caller inspects the status itself (used to assert refusals). */
export async function apiRaw(method: string, route: string, body?: unknown) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  return fetch(`${API_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function api(method: string, route: string, body?: unknown) {
  const res = await apiRaw(method, route, body)
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${await res.text()}`)
  return res.json()
}

/** A synthetic patient with a unique name, so no spec ever reads another run's record. */
export async function newPatient(prefix: string) {
  const lastName = `${prefix}${Date.now()}`
  const created = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const patientId: string = created.id ?? created.data?.id ?? created.patient?.id
  expect(patientId).toBeTruthy()
  return { patientId, lastName }
}

export async function getBudget(budgetId: string) {
  const b = await api('GET', `/budgets/${budgetId}`)
  return b.data ?? b
}

/**
 * Budget with one line executed through a REAL appointment link, which is the only
 * route to EXECUTED the server accepts (#675: `PATCH /budgets/:id/items/:itemId`
 * with `status: 'EXECUTED'` on a linkless item is refused with 409
 * ITEM_EXECUTED_REQUIRES_LINK).
 *
 * Consequence for callers: the recipe can only reach EXECUTED through an
 * *associable* budget, so the budget is created APPROVED (the API default) and,
 * once its only active line is executed, `deriveBudgetStatus` moves it to
 * COMPLETED — it is never DRAFT. Specs whose premise was "a DRAFT budget with an
 * executed line" must restate it as "a budget whose active line is executed".
 */
export async function budgetWithExecutedLink(patientId: string, execute: boolean) {
  const tag = `${Date.now()}`
  const doctor = await api('POST', '/doctors', {
    firstName: 'E2E',
    lastName: `Doc${tag}`,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })
  const b = await api('POST', `/patients/${patientId}/budgets`, {
    items: [{ description: `Linea ejecutable ${tag}`, quantity: 1, unitPrice: 500 }],
  })
  const budget = b.data ?? b
  expect(budget.status).toBe('APPROVED') // API default with no status sent
  const itemIds = (budget.items as { id: string }[]).map((i) => i.id)
  const start = new Date()
  start.setHours(9, 0, 0, 0)
  const appt = await api('POST', '/appointments', {
    patientId,
    doctorId: (doctor.data ?? doctor).id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    budgetItemIds: itemIds,
  })
  const apptId = (appt.data ?? appt).id
  const markDone = () =>
    api('PUT', `/appointments/${apptId}/mark-done`, { executedBudgetItemIds: itemIds })
  if (execute) await markDone()
  return { budget, itemIds, apptId, markDone }
}

/**
 * The budget's own status select on the detail page. It carries a `<label>Estado</label>`
 * sibling but is not wired to it for the a11y tree, so it is addressed through its
 * field wrapper.
 */
export const budgetStatusSelect = (page: Page) =>
  page
    .locator('div')
    .filter({ has: page.locator('> label', { hasText: /^Estado$/ }) })
    .locator('> select')

/**
 * The status select inside an item's edit card. Unlabelled; pinned by an option value
 * only the item-status list has (the budget status select never offers PENDING), so the
 * locator does not depend on the rendered language.
 */
export const itemStatusSelect = (page: Page) =>
  page.locator('select').filter({ has: page.locator('option[value="PENDING"]') })

export async function readOptionValues(select: Locator) {
  return select
    .locator('option:not([disabled])')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
}
