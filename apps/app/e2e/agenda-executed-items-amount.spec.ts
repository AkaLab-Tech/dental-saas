import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(__dirname, '../../../.task-log/screenshots')

/**
 * Task #619: the day's agenda must show the executed-items charge.
 *
 * Before the fix the agenda card rendered only `appointment.cost`, so a visit
 * whose charge comes from EXECUTED budget items showed no amount at all. Three
 * cards, three authorities:
 *   A. executed items, no typed cost -> the executed-items line with the total
 *   B. typed cost, no items          -> the typed cost, unchanged
 *   C. neither                       -> NO money region at all (absence is the design)
 *
 * Every record is synthetic, created through the API and found by its own
 * unique last name, never by list position.
 */

async function api(method: string, route: string, body?: unknown) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  const res = await fetch(`${API_BASE_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${await res.text()}`)
  const json = await res.json()
  return json.data ?? json
}

const money = (n: number) =>
  new RegExp(
    `[A-Z]{3}\\s*${n.toLocaleString('en-US', { minimumFractionDigits: 2 }).replace(/\./g, '\\.')}`
  )

function slot(hour: number) {
  const start = new Date()
  start.setHours(hour, 0, 0, 0)
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
  }
}

/** The card in the agenda list for the day headed "Hoy", pinned by last name. */
const todayAgendaCard = (page: Page, lastName: string) =>
  page
    .getByRole('heading', { name: /^hoy$/i, level: 3 })
    .locator('xpath=following-sibling::div[1]')
    .locator('div')
    .filter({ hasText: new RegExp(lastName) })
    // outermost matching div = the card; the name is unique to this run
    .first()

test.setTimeout(240_000)
test('agenda card shows executed-items amount, typed cost, or no money region (#619)', async ({
  authedPage: page,
}) => {
  const tag = `${Date.now()}`
  const doctor = await api('POST', '/doctors', {
    firstName: 'E2E',
    lastName: `Doc${tag}`,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })

  // A. executed items, no typed cost
  const lastA = `Ejecutados${tag}`
  const patientA = await api('POST', '/patients', { firstName: 'E2E', lastName: lastA })
  const budget = await api('POST', `/patients/${patientA.id}/budgets`, {
    status: 'APPROVED',
    items: [1500, 2500].map((unitPrice, i) => ({
      description: `Item${i}${tag}`,
      quantity: 1,
      unitPrice,
    })),
  })
  const itemIds = (budget.items as { id: string }[]).map((i) => i.id)
  const apptA = await api('POST', '/appointments', {
    patientId: patientA.id,
    doctorId: doctor.id,
    ...slot(9),
    budgetItemIds: itemIds,
  })
  await api('PUT', `/appointments/${apptA.id}/mark-done`, { executedBudgetItemIds: itemIds })

  // B. typed cost
  const lastB = `ConCosto${tag}`
  const patientB = await api('POST', '/patients', { firstName: 'E2E', lastName: lastB })
  await api('POST', '/appointments', {
    patientId: patientB.id,
    doctorId: doctor.id,
    ...slot(10),
    cost: 700,
  })

  // C. neither
  const lastC = `SinMonto${tag}`
  const patientC = await api('POST', '/patients', { firstName: 'E2E', lastName: lastC })
  await api('POST', '/appointments', {
    patientId: patientC.id,
    doctorId: doctor.id,
    ...slot(11),
  })

  await page.goto('/appointments')
  // Cold vite compile on a loaded host: generous wait, never a tight one.
  await expect(page.getByRole('heading', { name: /citas/i, level: 1 })).toBeVisible({
    timeout: 90_000,
  })

  const cardA = todayAgendaCard(page, lastA)
  const cardB = todayAgendaCard(page, lastB)
  const cardC = todayAgendaCard(page, lastC)
  await expect(cardA).toBeVisible()
  await expect(cardB).toBeVisible()
  await expect(cardC).toBeVisible()

  // A: the fix working.
  const amountA = cardA.getByTestId('appointment-amount')
  await expect(amountA).toHaveCount(1)
  await expect(amountA).toContainText(/Ítems de presupuesto ejecutados en esta cita/)
  await expect(amountA).toContainText('2')
  await expect(amountA).toContainText(money(4000))
  console.log(`CARD_A: ${(await cardA.innerText()).replace(/\n/g, ' | ')}`)

  // B: typed cost still renders its own amount.
  const amountB = cardB.getByTestId('appointment-amount')
  await expect(amountB).toHaveCount(1)
  await expect(amountB).toContainText(money(700))
  await expect(amountB).not.toContainText(/Ítems de presupuesto ejecutados/)
  console.log(`CARD_B: ${(await cardB.innerText()).replace(/\n/g, ' | ')}`)

  // C: no money region at all.
  await expect(cardC.getByTestId('appointment-amount')).toHaveCount(0)
  await expect(cardC).not.toContainText(/[A-Z]{3}\s*\d/)
  console.log(`CARD_C: ${(await cardC.innerText()).replace(/\n/g, ' | ')}`)

  await page.screenshot({ path: `${SHOTS}/619-01-agenda-three-cards.png`, fullPage: true })
  await cardA.screenshot({ path: `${SHOTS}/619-02-card-executed-items.png` })
  await cardB.screenshot({ path: `${SHOTS}/619-03-card-typed-cost.png` })
  await cardC.screenshot({ path: `${SHOTS}/619-04-card-no-amount.png` })
})
