import { readFileSync } from 'fs'
import type { Page } from '@playwright/test'
import { test as authedTest, expect as authedExpect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'
const SHOTS = '.task-log/screenshots'

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

/** The value shown beside a money label, inside the one <dl> that carries all three. */
function figure(page: Page, label: string) {
  const dl = page.locator('dl').filter({ has: page.getByText('Abonado', { exact: true }) })
  return dl.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
}

const MONEY = /^[A-Z]{3}\s[\d,]+\.\d{2}$/

authedTest('budget money figures on card and detail header (#612)', async ({ authedPage: page }) => {
  const lastName = `DineroPres${Date.now()}`
  const created = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const patientId: string = created.id ?? created.data?.id ?? created.patient?.id
  authedExpect(patientId).toBeTruthy()

  const b = await api('POST', `/patients/${patientId}/budgets`, {
    status: 'APPROVED',
    items: [{ description: 'Tratamiento sintetico 612', quantity: 1, unitPrice: 500 }],
  })
  const budgetId: string = (b.data ?? b).id
  authedExpect(budgetId).toBeTruthy()

  await page.goto(`/patients/${patientId}`)
  await authedExpect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()

  // Card: nothing charged -> formatted zeros for covered and remaining.
  const cardSelect = page.getByRole('combobox', { name: 'Estado' })
  await authedExpect(cardSelect).toHaveValue('APPROVED')
  await authedExpect(figure(page, 'Abonado')).toHaveText(MONEY)
  await authedExpect(figure(page, 'Abonado')).toHaveText(/\s0\.00$/)
  await authedExpect(figure(page, 'Pendiente de pago')).toHaveText(/\s0\.00$/)
  await authedExpect(figure(page, 'Sin ejecutar')).toHaveText(MONEY)
  await page.screenshot({ path: `${SHOTS}/612-card-approved-zero-charged.png`, fullPage: true })

  // Status change from the card: PATCH response carries money, figures stay present.
  const patchResp = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/budgets/${budgetId}`)
  )
  await cardSelect.selectOption('CANCELLED')
  const patch = await patchResp
  const patched = await patch.json()
  authedExpect((patched.data ?? patched).money).toBeTruthy()
  await authedExpect(cardSelect).toHaveValue('CANCELLED')
  for (const label of ['Abonado', 'Pendiente de pago', 'Sin ejecutar']) {
    await authedExpect(figure(page, label)).toHaveText(MONEY)
  }
  await page.screenshot({ path: `${SHOTS}/612-card-after-status-change.png`, fullPage: true })

  // Detail header.
  await page.goto(`/patients/${patientId}/budgets/${budgetId}`)
  await authedExpect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  for (const label of ['Abonado', 'Pendiente de pago', 'Sin ejecutar']) {
    await authedExpect(figure(page, label)).toHaveText(MONEY)
  }
  const notBilledBefore = (await figure(page, 'Sin ejecutar').textContent()) ?? ''
  await page.screenshot({ path: `${SHOTS}/612-detail-header-money.png`, fullPage: true })

  // Reinstate to APPROVED so an added item counts as not-yet-executed, then add one.
  const detailSelect = page.locator('div').filter({ has: page.locator('> label', { hasText: /^Estado$/ }) }).locator('> select')
  const approve = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/budgets/${budgetId}`)
  )
  await detailSelect.selectOption('APPROVED')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await approve

  await page.getByRole('button', { name: 'Agregar ítem' }).click()
  await page.getByPlaceholder('Ej: Extracción molar superior').fill('Item agregado 612')
  const priceInput = page.locator('input[type="number"][step="0.01"]').last()
  await priceInput.fill('250')
  const addResp = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/budgets/${budgetId}/items`)
  )
  await page.getByRole('button', { name: 'Agregar ítem' }).last().click()
  const add = await addResp
  authedExpect(add.ok()).toBe(true)
  await authedExpect(page.getByText('Item agregado 612')).toBeVisible()
  for (const label of ['Abonado', 'Pendiente de pago', 'Sin ejecutar']) {
    await authedExpect(figure(page, label)).toHaveText(MONEY)
  }
  await authedExpect(figure(page, 'Sin ejecutar')).not.toHaveText(notBilledBefore)
  await page.screenshot({ path: `${SHOTS}/612-detail-after-add-item.png`, fullPage: true })
})
