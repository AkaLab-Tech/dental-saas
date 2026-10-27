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

/**
 * Task #642: the amount must land on the card from the completion itself.
 *
 * `PUT /appointments/:id/mark-done` used to build its response before
 * `confirmExecutedBudgetItems` wrote the EXECUTED join rows, so `budgetItems`
 * came back undefined for exactly the items that request had just confirmed.
 * `completeAppointment` swaps the write response into the row wholesale and
 * never refetches, so the card went back to showing no amount at all.
 *
 * The axis no unit or integration test can own is that the figure is on the
 * card afterwards — and it only discriminates while the page is NOT reloaded
 * and NOT navigated, because either one triggers the list refetch that masks
 * the bug. Both are therefore asserted, not merely avoided: a `window`
 * sentinel set before the click would be wiped by a reload or a remount, and
 * the URL is compared before and after.
 */
test('completing a visit from the agenda puts the executed-items amount on its own card, with no navigation and no reload (#642)', async ({
  authedPage: page,
}) => {
  const tag = `${Date.now()}`
  const doctor = await api('POST', '/doctors', {
    firstName: 'E2E',
    lastName: `Doc${tag}`,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })

  // A visit whose only charge authority is its executed items: no typed cost,
  // so the money region exists if and only if the server sent `budgetItems`.
  const last = `Completada${tag}`
  const patient = await api('POST', '/patients', { firstName: 'E2E', lastName: last })
  const budget = await api('POST', `/patients/${patient.id}/budgets`, {
    status: 'APPROVED',
    items: [1200, 800].map((unitPrice, i) => ({
      description: `ItemC${i}${tag}`,
      quantity: 1,
      unitPrice,
    })),
  })
  const itemIds = (budget.items as { id: string }[]).map((i) => i.id)
  await api('POST', '/appointments', {
    patientId: patient.id,
    doctorId: doctor.id,
    ...slot(13),
    budgetItemIds: itemIds,
  })

  await page.goto('/appointments')
  await expect(page.getByRole('heading', { name: /citas/i, level: 1 })).toBeVisible({
    timeout: 90_000,
  })

  const card = todayAgendaCard(page, last)
  await expect(card).toBeVisible()

  // Precondition: the items are only SCHEDULED, so nothing bills yet. This is
  // also the state the bug left behind after completing, which is why the
  // post-completion assertion below discriminates.
  await expect(card.getByTestId('appointment-amount')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/642-01-card-before-completing.png`, fullPage: true })

  const urlBefore = page.url()
  await page.evaluate(() => {
    ;(window as unknown as Record<string, string>).__e2e642Sentinel = 'same-document'
  })

  await card.getByRole('button', { name: /^más opciones$/i }).click()
  await card.getByRole('button', { name: /^marcar completada$/i }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: /^completar cita$/i, level: 2 })).toBeVisible()
  // Both associated items default to executed; the doctor opts out, not in.
  const itemBoxes = dialog.getByRole('checkbox')
  await expect(itemBoxes).toHaveCount(itemIds.length)
  for (const box of await itemBoxes.all()) await expect(box).toBeChecked()
  await dialog.screenshot({ path: `${SHOTS}/642-02-complete-modal-items-checked.png` })

  await dialog.getByRole('button', { name: /^marcar completada$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(/cita marcada como completada/i)).toBeVisible()

  // The fix: the write response already carries the EXECUTED links, so the row
  // the store swapped in renders the charge with no further request.
  const amount = card.getByTestId('appointment-amount')
  await expect(amount).toHaveCount(1)
  await expect(amount).toContainText(/Ítems de presupuesto ejecutados en esta cita/)
  await expect(amount).toContainText(String(itemIds.length))
  await expect(amount).toContainText(money(2000))
  await expect(card).toContainText(/completada/i)
  console.log(`CARD_642: ${(await card.innerText()).replace(/\n/g, ' | ')}`)

  // Proof the figure above was not produced by a refetch: same URL, same
  // document (the sentinel survives only if the page was never reloaded).
  expect(page.url()).toBe(urlBefore)
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, string>).__e2e642Sentinel
    )
  ).toBe('same-document')

  await page.screenshot({ path: `${SHOTS}/642-03-agenda-after-completing.png`, fullPage: true })
  await card.screenshot({ path: `${SHOTS}/642-04-card-after-completing.png` })
})
