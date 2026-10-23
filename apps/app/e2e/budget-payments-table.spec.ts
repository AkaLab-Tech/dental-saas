import { readFileSync } from 'fs'
import { test, expect } from './fixtures/authed'
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
  const json = await res.json()
  return json.data ?? json
}

/** Payments table inside the budget detail (#613): empty state, then one row after a line is EXECUTED. */
test('budget detail payments table: empty state, then a row once a line is executed (#613)', async ({
  authedPage: page,
}) => {
  const tag = `${Date.now()}`
  const lastName = `Pagos${tag}`
  const patient = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const budget = await api('POST', `/patients/${patient.id}/budgets`, {
    status: 'APPROVED',
    items: [{ description: `Limpieza${tag}`, quantity: 1, unitPrice: 800 }],
  })
  const itemId: string = budget.items[0].id
  const doctor = await api('POST', '/doctors', {
    firstName: 'E2E',
    lastName: `Doc${tag}`,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })

  const detailUrl = `/patients/${patient.id}/budgets/${budget.id}`
  await page.goto(detailUrl)
  await expect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pagos', level: 2 })).toBeVisible()
  await expect(page.getByText('Aún no hay visitas con cobro en este presupuesto.')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/613-payments-empty.png`, fullPage: true })

  const start = new Date()
  start.setHours(11, 0, 0, 0)
  const appt = await api('POST', '/appointments', {
    patientId: patient.id,
    doctorId: doctor.id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    budgetItemIds: [itemId],
  })
  await api('PUT', `/appointments/${appt.id}/mark-done`, { executedBudgetItemIds: [itemId] })

  await page.goto(detailUrl)
  await expect(page.getByRole('heading', { name: 'Pagos', level: 2 })).toBeVisible()
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  for (const h of ['Fecha', 'Qué se hizo', 'Notas', 'Cobrado', 'Abonado']) {
    await expect(table.getByRole('columnheader', { name: h })).toBeVisible()
  }
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(`Limpieza${tag}`)
  await expect(rows.first()).toContainText(/[A-Z]{3}\s*800\.00/)
  await expect(page.getByText('Aún no hay visitas con cobro en este presupuesto.')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/613-payments-one-row.png`, fullPage: true })
})
