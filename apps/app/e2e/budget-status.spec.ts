import { readFileSync } from 'fs'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'
const SHOTS = '.task-log/screenshots'

/**
 * Budget status control on the card + status select on the create modal (#606).
 * The patient is created through the API with a unique synthetic name and opened
 * by id; the budget is pinned by its own id (no list position is ever used).
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

test('budget status: create with non-default status, change from the card, detail headings (#606)', async ({
  authedPage: page,
}) => {
  const lastName = `EstadoPres${Date.now()}`
  const created = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const patientId: string = created.id ?? created.data?.id ?? created.patient?.id
  expect(patientId).toBeTruthy()

  await page.goto(`/patients/${patientId}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()

  // Create with a non-default status (APPROVED); capture the POST to pin the budget id.
  await page.getByRole('button', { name: /nuevo presupuesto/i }).first().click()
  const dialog = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Nuevo Presupuesto', level: 2 }) })
  await expect(dialog).toBeVisible()
  const statusSelect = dialog.getByLabel('Estado')
  await expect(statusSelect).toHaveValue('DRAFT')
  await statusSelect.selectOption('APPROVED')
  await dialog.locator('input[name="items.0.description"]').fill('Tratamiento sintetico 606')
  await dialog.locator('input[name="items.0.unitPrice"]').fill('500')

  const postResp = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/patients/${patientId}/budgets`)
  )
  await dialog.getByRole('button', { name: /guardar|crear/i }).last().click()
  const resp = await postResp
  const body = await resp.json()
  const budgetId: string = body.id ?? body.data?.id ?? body.budget?.id
  expect(budgetId).toBeTruthy()
  expect(resp.request().postDataJSON().status).toBe('APPROVED')
  await expect(dialog).not.toBeVisible()

  // Pin the card by the id of its detail link.
  // The patient is synthetic and owns exactly this one budget (asserted via the
  // PATCH url below); the detail link lives in the closed card menu, so the
  // card is addressed by its status control.
  const cardSelect = page.getByRole('combobox', { name: 'Estado' })
  await expect(cardSelect).toHaveCount(1)
  await expect(cardSelect).toHaveValue('APPROVED')
  await page.screenshot({ path: `${SHOTS}/606-card-created-approved.png`, fullPage: true })

  // Change from the card: persists after reload.
  const patchResp = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/budgets/${budgetId}`)
  )
  await cardSelect.selectOption('CANCELLED')
  const patch = await patchResp
  expect(patch.request().postDataJSON().status).toBe('CANCELLED')
  await expect(cardSelect).toHaveValue('CANCELLED')
  await page.screenshot({ path: `${SHOTS}/606-card-status-control-cancelled.png`, fullPage: true })

  await page.reload()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()
  await expect(page.getByRole('combobox', { name: 'Estado' })).toHaveValue('CANCELLED')

  // Detail page headings.
  await page.goto(`/patients/${patientId}/budgets/${budgetId}`)
  await expect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  await expect(page.getByText('Notas', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/606-detail-metadata-card.png`, fullPage: true })
})
