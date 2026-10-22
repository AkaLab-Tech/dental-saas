import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The worktree's own artifact directory (apps/app/e2e -> repo root), so the
// PNGs land in <worktree>/.task-log/screenshots regardless of Playwright's cwd.
const SHOTS = path.resolve(__dirname, '../../../.task-log/screenshots')

/**
 * APPOINTMENT_COST_IS_THE_AUTHORITY, in a browser (task #590).
 *
 * The rule: a budget item holding an EXECUTED link does NOT create its own
 * charge when the appointment it is executed on carries a cost above zero —
 * that appointment's cost is the charge for the visit. With no cost on the
 * appointment, the executed item bills exactly as it did before. The cost
 * field stays EDITABLE (the operator chose option B; the read-only variant
 * was withdrawn), so this spec asserts the field can still be typed into.
 *
 * Why each surface gets its own stated expectation instead of one assertion
 * that the three agree: they are three distinct server code paths, so an
 * equality between them could be satisfied by all three being wrong together.
 *
 *   1. patient record -> Citas tab card      appointment.service.ts, SafeAppointment.budgetItems
 *   2. patient statement (header + Entregas) payment.service.ts getBillableItems, per LINK, in memory
 *   3. day's agenda card (/appointments)     the appointment list's own cost render
 *
 * The second test is the control: the same fixture with no cost on the visit,
 * where all three surfaces must show the items' own charge. Without it, a
 * server that simply stopped charging executed items everywhere would pass.
 *
 * Every record is created through the API with a synthetic identifier and
 * opened by its id; no locator takes a list position (`.first()` on a
 * client-side-sorted list has landed a writing spec on another run's record
 * before). Headings are pinned by name AND level — the shell renders
 * <h1>Alveo</h1> on every page.
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

/**
 * A money figure as this app renders it. formatCurrency uses en-US grouping
 * with currencyDisplay: 'code', and the code is the TENANT's currency (UYU on
 * a freshly registered clinic, not USD), so the code is matched as a class and
 * never hard-coded.
 */
const money = (n: number) =>
  new RegExp(
    `[A-Z]{3}\\s*${n.toLocaleString('en-US', { minimumFractionDigits: 2 }).replace(/\./g, '\\.')}`
  )

async function createDoctor(tag: string) {
  const doctor = await api('POST', '/doctors', {
    firstName: 'E2E',
    lastName: `Doc${tag}`,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })
  return { id: doctor.id as string, label: `Doc${tag}` }
}

async function createPatientWithBudget(lastName: string, tag: string, prices: number[]) {
  const patient = await api('POST', '/patients', { firstName: 'E2E', lastName })
  const budget = await api('POST', `/patients/${patient.id}/budgets`, {
    status: 'APPROVED',
    items: prices.map((unitPrice, i) => ({
      description: `Item${String.fromCharCode(65 + i)}${tag}`,
      quantity: 1,
      unitPrice,
    })),
  })
  const items = (budget.items as { id: string; description: string }[]).map((it) => ({
    id: it.id,
    description: it.description,
  }))
  return { patientId: patient.id as string, budgetId: budget.id as string, items }
}

/** Open this run's patient by id and prove which record is on screen. */
async function openPatient(page: Page, patientId: string, lastName: string) {
  await page.goto(`/patients/${patientId}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Tabs' })

/**
 * Open the Citas tab AND the appointments section inside it.
 *
 * The section persists a collapsed/expanded preference in localStorage and
 * starts COLLAPSED in a fresh browser profile, so none of its cards exist in
 * the DOM until the operator opens it — asserting the absence of a line
 * without this step is vacuous. The period filter is then set to "Todas" so a
 * read never depends on whether a time earlier today still counts as upcoming.
 */
async function openCitas(page: Page) {
  await tabs(page).getByRole('button', { name: 'Citas' }).click()
  const allPeriod = page.getByRole('button', { name: 'Todas', exact: true })
  if (!(await allPeriod.isVisible().catch(() => false))) {
    await page.getByRole('heading', { name: 'Citas', level: 2 }).click()
  }
  await expect(allPeriod).toBeVisible()
  await allPeriod.click()
  // Prove the period filter actually moved: an absence asserted below (no
  // executed-items line) must not be a card the filter is hiding.
  await expect(allPeriod).toHaveClass(/bg-blue-600/)
}

/** The card's own root element in PatientAppointmentsSection. */
const patientCards = (page: Page) => page.locator('div.relative.w-52.rounded-lg')

/** The cost input: its <label> is a sibling, not a wrapper, so no getByLabel. */
const costField = (dialog: ReturnType<Page['getByRole']>) =>
  dialog.locator('label', { hasText: /^Costo \(\$\)$/ }).locator('xpath=following-sibling::input[1]')

/** The card in the agenda list for the day headed "Hoy". */
const todayAgendaCard = (page: Page, lastName: string) =>
  page
    .getByRole('heading', { name: /^hoy$/i, level: 3 })
    .locator('xpath=following-sibling::div[1]')
    .locator('div')
    .filter({ hasText: new RegExp(lastName) })
    .first()

test.describe('Appointment cost is the single authority (#590)', () => {
  test('costed visit: prefill -> retype -> save, then each of the three surfaces', async ({
    authedPage: page,
  }) => {
    const tag = `${Date.now()}`
    const lastName = `Autoridad${tag}`
    const doctor = await createDoctor(tag)
    const { patientId, items } = await createPatientWithBudget(lastName, tag, [1500, 1000])
    expect(items).toHaveLength(2)

    // ---------------------------------------------------------------- the walk
    await openPatient(page, patientId, lastName)
    await openCitas(page)
    await page.getByRole('button', { name: /nueva cita/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const cost = costField(dialog)
    await expect(cost).toHaveCount(1)
    await expect(cost).toHaveValue('')
    await expect(cost).toBeEditable()

    // Doctor is required to save. DoctorPicker is a combobox and its <label>
    // does carry htmlFor, so getByLabel resolves it.
    const doctorInput = dialog.getByLabel(/^Doctor/)
    await doctorInput.click()
    await doctorInput.fill(doctor.label)
    await dialog.getByRole('option', { name: new RegExp(doctor.label) }).click()

    // Step 1 — tick one item: the cost field prefills with its total.
    const itemA = dialog.getByRole('checkbox', { name: new RegExp(items[0].description) })
    const itemB = dialog.getByRole('checkbox', { name: new RegExp(items[1].description) })
    const hint = dialog.getByText(/Ítems del presupuesto de esta cita/)
    await itemA.check()
    await expect(cost).toHaveValue('1500')
    // Ticking the second replaces the prefill's OWN last proposal, 1500 -> 2500.
    await itemB.check()
    await expect(cost).toHaveValue('2500')
    await expect(hint).toContainText(money(2500))
    // #590 removed the amber duplication warning: with the cost superseding the
    // items there is no double charge left to warn about, so no alert may fire.
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/590-01-prefill-2500.png`, fullPage: true })

    // Step 2 — type a different figure over the prefill.
    await cost.fill('2000')
    await expect(cost).toHaveValue('2000')
    // The prefill must not reclaim a typed figure: toggling the items again
    // moves the proposed total twice and the typed 2000 has to survive both.
    await itemB.uncheck()
    await expect(hint).toContainText(money(1500))
    await expect(cost).toHaveValue('2000')
    await itemB.check()
    await expect(hint).toContainText(money(2500))
    await expect(cost).toHaveValue('2000')
    await page.screenshot({ path: `${SHOTS}/590-02-typed-2000-over-prefill.png`, fullPage: true })

    // Step 3 — save, and read what actually went to the server.
    const posted = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/appointments$/.test(r.url())
    )
    await dialog.getByRole('button', { name: /crear cita/i }).click()
    const payload = (await posted).postDataJSON()
    console.log(`SAVED_PAYLOAD: cost=${payload.cost} items=${JSON.stringify(payload.budgetItemIds)}`)
    expect(payload.cost).toBe(2000)
    expect(payload.budgetItemIds).toEqual(expect.arrayContaining([items[0].id, items[1].id]))
    expect(payload.budgetItemIds).toHaveLength(2)
    await expect(dialog).not.toBeVisible()

    // ------------------------------------------- confirm the items as EXECUTED
    // Through the UI: the completion modal defaults every associated item ON.
    await expect(patientCards(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Opciones' }).click()
    await page.getByRole('button', { name: /marcar completada/i }).click()
    const completeDialog = page.getByRole('dialog')
    await expect(completeDialog).toBeVisible()
    await expect(completeDialog.getByText(/completar cita/i)).toBeVisible()
    const executedToggles = completeDialog.getByRole('checkbox')
    await expect(executedToggles).toHaveCount(2)
    await expect(executedToggles.nth(0)).toBeChecked()
    await expect(executedToggles.nth(1)).toBeChecked()
    await completeDialog.getByRole('button', { name: /marcar completada/i }).click()
    await expect(completeDialog).not.toBeVisible()

    // The appointment this run created, read back by id from the API, so the
    // figures below are anchored to a row we know is ours.
    const mine = (await api('GET', `/appointments/by-patient/${patientId}`)) as Array<{
      id: string
      cost: string | number | null
      status: string
      budgetItems?: { count: number; cost: number }
    }>
    expect(mine).toHaveLength(1)
    console.log(
      `API_APPOINTMENT: status=${mine[0].status} cost=${mine[0].cost} budgetItems=${JSON.stringify(
        mine[0].budgetItems ?? null
      )}`
    )
    expect(mine[0].status).toBe('COMPLETED')
    expect(Number(mine[0].cost)).toBe(2000)
    // The superseded items are not sent at all (see the SafeAppointment field
    // comment): their absence is what the card reads below. The control test
    // proves this endpoint does send the block when it is a charge.
    expect(mine[0].budgetItems).toBeUndefined()

    // ------------------------------------------------------- SURFACE 1: the card
    // Expectation: one money figure, 2,000.00 — the typed cost — and NO
    // "Ítems de presupuesto ejecutados en esta cita" line beside it.
    await openPatient(page, patientId, lastName)
    await openCitas(page)
    const appointmentCard = patientCards(page)
    await expect(appointmentCard).toHaveCount(1)
    console.log(`SURFACE_1_CARD: ${(await appointmentCard.innerText()).replace(/\n/g, ' | ')}`)
    await expect(appointmentCard).toContainText(money(2000))
    await expect(appointmentCard).not.toContainText(money(2500))
    await expect(page.getByText(/Ítems de presupuesto ejecutados en esta cita/)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/590-03-surface1-appointment-card.png`, fullPage: true })

    // ---------------------------------------- SURFACE 2: the patient statement
    // Expectation: debt 2,000.00 — the visit's cost, charged once. 2,500.00
    // (the items on their own) and 4,500.00 (both) are the two wrong answers.
    const header = page.getByTestId('patient-balance')
    await expect(header).toBeVisible()
    await expect(header).not.toContainText('—')
    console.log(`SURFACE_2_HEADER: ${(await header.innerText()).replace(/\n/g, ' | ')}`)
    await expect(header).toContainText(money(2000))
    await expect(header).not.toContainText(money(2500))
    await expect(header).not.toContainText(money(4500))

    await tabs(page).getByRole('button', { name: 'Entregas' }).click()
    const statement = page
      .locator('div')
      .filter({ hasText: /^Deuda por consultas realizadas/ })
      .last()
    await expect(statement).toBeVisible()
    console.log(`SURFACE_2_STATEMENT: ${(await statement.innerText()).replace(/\n/g, ' | ')}`)
    await expect(statement).toContainText(money(2000))
    await page.screenshot({ path: `${SHOTS}/590-04-surface2-patient-statement.png`, fullPage: true })

    // ------------------------------------------- SURFACE 3: the day's agenda
    // Expectation: the card for today shows 2,000.00 and no second figure.
    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: /citas/i, level: 1 })).toBeVisible()
    const agendaCard = todayAgendaCard(page, lastName)
    await expect(agendaCard).toBeVisible()
    console.log(`SURFACE_3_AGENDA: ${(await agendaCard.innerText()).replace(/\n/g, ' | ')}`)
    await expect(agendaCard).toContainText(money(2000))
    await expect(agendaCard).not.toContainText(money(2500))
    await page.screenshot({ path: `${SHOTS}/590-05-surface3-day-agenda.png`, fullPage: true })

    // ------------------------- the field is still editable after the fact
    // Option A (a read-only cost) was withdrawn: reopening the saved visit must
    // show the typed 2000, the items' total as a hint, and an editable input.
    await openPatient(page, patientId, lastName)
    await openCitas(page)
    await page.getByRole('button', { name: 'Opciones' }).click()
    await page.getByRole('button', { name: /^Editar$/ }).click()
    const editDialog = page.getByRole('dialog')
    await expect(editDialog).toBeVisible()
    const editCost = costField(editDialog)
    await expect(editCost).toHaveValue('2000')
    await expect(editCost).toBeEditable()
    await expect(editDialog.getByText(/Ítems del presupuesto de esta cita/)).toContainText(
      money(2500)
    )
    await page.screenshot({ path: `${SHOTS}/590-06-edit-form-keeps-2000.png`, fullPage: true })
    console.log('EDIT_FORM: cost field holds 2000 and is editable; items hint shows 2,500.00')
  })

  test('control: with no cost on the visit, the executed items still bill', async ({
    authedPage: page,
  }) => {
    const tag = `${Date.now()}`
    const lastName = `SinCosto${tag}`
    const doctor = await createDoctor(`Ctl${tag}`)
    const { patientId, items } = await createPatientWithBudget(lastName, tag, [1500, 1000])

    const start = new Date()
    start.setHours(11, 0, 0, 0)
    const end = new Date(start.getTime() + 30 * 60_000)
    const appointment = await api('POST', '/appointments', {
      patientId,
      doctorId: doctor.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      budgetItemIds: items.map((i) => i.id),
    })
    await api('PUT', `/appointments/${appointment.id}/mark-done`, {
      executedBudgetItemIds: items.map((i) => i.id),
    })

    // Surface 1: no cost line, and the executed-items line IS present at 2,500.
    await openPatient(page, patientId, lastName)
    await openCitas(page)
    const card = patientCards(page)
    await expect(card).toHaveCount(1)
    console.log(`CONTROL_SURFACE_1_CARD: ${(await card.innerText()).replace(/\n/g, ' | ')}`)
    const executedLine = card.getByText(/Ítems de presupuesto ejecutados en esta cita/)
    await expect(executedLine).toBeVisible()
    await expect(executedLine).toContainText('2')
    await expect(executedLine).toContainText(money(2500))
    await page.screenshot({ path: `${SHOTS}/590-07-control-card-items-bill.png`, fullPage: true })

    // Surface 2: the statement charges the items, 2,500.
    const header = page.getByTestId('patient-balance')
    await expect(header).toBeVisible()
    await expect(header).not.toContainText('—')
    console.log(`CONTROL_SURFACE_2_HEADER: ${(await header.innerText()).replace(/\n/g, ' | ')}`)
    await expect(header).toContainText(money(2500))
    await page.screenshot({ path: `${SHOTS}/590-08-control-statement-2500.png`, fullPage: true })

    // Surface 3: the agenda card carries no cost figure of its own — the visit
    // has no cost, and the agenda never showed the items' charge.
    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: /citas/i, level: 1 })).toBeVisible()
    const agendaCard = todayAgendaCard(page, lastName)
    await expect(agendaCard).toBeVisible()
    console.log(`CONTROL_SURFACE_3_AGENDA: ${(await agendaCard.innerText()).replace(/\n/g, ' | ')}`)
    await expect(agendaCard).not.toContainText(money(2500))
    await page.screenshot({ path: `${SHOTS}/590-09-control-agenda-no-cost.png`, fullPage: true })
  })
})
