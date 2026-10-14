import { readFileSync } from 'fs'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'

/**
 * Entregas form: optional "reserve to a budget" select (#569, slice 1).
 *
 * Every patient here is created through the API with a unique synthetic name and
 * opened by its id, then the heading is asserted to carry that name before
 * anything is recorded. No list position is ever used to pick a record.
 */
async function api(method: string, route: string, body?: unknown) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  const res = await fetch(`${API_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${await res.text()}`)
  return res.json()
}

async function createPatient(lastName: string): Promise<string> {
  const created = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const id: string = created.id ?? created.data?.id ?? created.patient?.id
  if (!id) throw new Error(`no patient id in ${JSON.stringify(created)}`)
  return id
}

async function createBudget(patientId: string, status: string, unitPrice: number) {
  await api('POST', `/patients/${patientId}/budgets`, {
    status,
    items: [{ description: 'Tratamiento sintetico', quantity: 1, unitPrice }],
  })
}

const SHOTS = '.task-log/screenshots'

test.describe('Advance form: reserve to a budget (#569)', () => {
  test('no reservable budget: no select, and a general advance is recorded as before', async ({
    authedPage: page,
  }) => {
    const lastName = `ReservaSin${Date.now()}`
    const id = await createPatient(lastName)
    // Present but not reservable: must not produce a control either.
    await createBudget(id, 'CANCELLED', 1000)
    await createBudget(id, 'COMPLETED', 1000)

    await page.goto(`/patients/${id}`)
    await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Tabs' })
      .getByRole('button', { name: 'Entregas' })
      .click()
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel(/monto/i).fill('120')
    // The options load asynchronously: wait for the budgets request to settle
    // before asserting absence, otherwise the count is vacuously 0.
    await page.waitForLoadState('networkidle')
    await expect(dialog.locator('#payment-budget')).toHaveCount(0)
    await expect(dialog.getByText(/reservar a un presupuesto/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/569-no-reservable-budget.png`, fullPage: true })

    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/patients/${id}/payments`))
    await dialog.getByRole('button', { name: /guardar/i }).click()
    const body = (await req).postDataJSON()
    expect(body.amount).toBe(120)
    expect(body).not.toHaveProperty('budgetId')
    await expect(dialog).not.toBeVisible()
  })

  test('reservable budget: select lists only it; empty = general, picked = reserved', async ({
    authedPage: page,
  }) => {
    const lastName = `ReservaCon${Date.now()}`
    const id = await createPatient(lastName)
    await createBudget(id, 'CANCELLED', 999) // must not be offered
    await createBudget(id, 'APPROVED', 2500)

    await page.goto(`/patients/${id}`)
    await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    await tabs.getByRole('button', { name: 'Entregas' }).click()

    // --- left empty: ordinary general advance ---
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    let dialog = page.getByRole('dialog')
    const select = dialog.locator('#payment-budget')
    await expect(select).toBeVisible()
    await expect(dialog.getByLabel(/reservar a un presupuesto/i)).toBeVisible()
    // "Sin reservar" + exactly the one APPROVED budget; the CANCELLED one is absent.
    await expect(select.locator('option')).toHaveCount(2)
    await expect(select).toHaveValue('')
    await expect(select.locator('option').nth(1)).toContainText(/2[.,]?500/)
    await expect(select.locator('option', { hasText: /999/ })).toHaveCount(0)
    await dialog.getByLabel(/monto/i).fill('100')
    await page.screenshot({ path: `${SHOTS}/569-select-visible-empty.png`, fullPage: true })
    let req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/patients/${id}/payments`))
    await dialog.getByRole('button', { name: /guardar/i }).click()
    let body = (await req).postDataJSON()
    expect(body.amount).toBe(100)
    expect(body).not.toHaveProperty('budgetId')
    await expect(dialog).not.toBeVisible()

    // --- picked: reserved to that budget ---
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    dialog = page.getByRole('dialog')
    const select2 = dialog.locator('#payment-budget')
    await expect(select2.locator('option')).toHaveCount(2)
    await select2.selectOption({ index: 1 })
    const picked = await select2.inputValue()
    expect(picked).not.toBe('')
    await dialog.getByLabel(/monto/i).fill('200')
    await page.screenshot({ path: `${SHOTS}/569-select-picked.png`, fullPage: true })
    req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/patients/${id}/payments`))
    await dialog.getByRole('button', { name: /guardar/i }).click()
    body = (await req).postDataJSON()
    expect(body.amount).toBe(200)
    expect(body.budgetId).toBe(picked)
    await expect(dialog).not.toBeVisible()
    await page.screenshot({ path: `${SHOTS}/569-after-reserved-advance.png`, fullPage: true })
  })
})
