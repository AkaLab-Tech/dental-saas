import { mkdirSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'

const here = path.dirname(fileURLToPath(import.meta.url))
/**
 * Resolved from this file, never from cwd: the artifact the PR points at is the
 * worktree-root `.task-log/screenshots/` (gitignored), and a relative path would
 * silently land in whichever directory playwright happened to be launched from.
 */
const SHOTS = path.resolve(here, '../../../.task-log/screenshots')
mkdirSync(SHOTS, { recursive: true })
const shot = (name: string) => path.join(SHOTS, `571-${name}.png`)

/**
 * Task #571 — the browser layer of the budget-reservation slice.
 *
 * Every patient is created through the API under a unique synthetic name (never
 * a real one) and opened by id; the level-1 heading is asserted to carry that
 * name before anything is recorded, because the shell renders a bare
 * <h1>Alveo</h1> on every page and the patients list sorts client-side (#564).
 *
 * GUARD 4 below is the one surface no layer had ever driven in a browser: the
 * budget changes state BETWEEN the picker's options loading and the form
 * submitting. The clinic shares one phone, so a stale tab is the normal case.
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

async function createBudget(
  patientId: string,
  status: string,
  unitPrice: number
): Promise<{ id: string; createdAt: string }> {
  const created = await api('POST', `/patients/${patientId}/budgets`, {
    status,
    items: [{ description: 'Tratamiento sintetico', quantity: 1, unitPrice }],
  })
  const budget = created.data ?? created
  if (!budget?.id) throw new Error(`no budget id in ${JSON.stringify(created)}`)
  return { id: budget.id, createdAt: budget.createdAt }
}

async function paymentCount(patientId: string): Promise<number> {
  const res = await api('GET', `/patients/${patientId}/payments`)
  return res.pagination.total
}

async function openEntregas(page: import('@playwright/test').Page, id: string, lastName: string) {
  await page.goto(`/patients/${id}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Entregas' }).click()
}

// ============================================================================
// GUARD 4 — the stale picker, as a real browser race
// ============================================================================
test.describe('Task #571 GUARD 4: a budget that closes while the form is open', () => {
  test('the stale pick is refused by the API, the reason is shown, the picker re-reads as all-closed, and NO entrega is written', async ({
    authedPage: page,
  }) => {
    const lastName = `Carrera${Date.now()}`
    const id = await createPatient(lastName)
    const budget = await createBudget(id, 'APPROVED', 2500)

    await openEntregas(page, id, lastName)
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    const dialog = page.getByRole('dialog')
    const select = dialog.locator('#payment-budget')

    // --- t0: the options have loaded with the budget still open ---
    await expect(select).toBeVisible()
    await expect(select.locator('option')).toHaveCount(2)
    await select.selectOption({ index: 1 })
    expect(await select.inputValue()).toBe(budget.id)
    await dialog.getByLabel(/monto/i).fill('300')
    await page.screenshot({ path: shot('guard4-stale-pick-staged'), fullPage: true })

    // --- t1: the world changes under the open form (another tab/phone) ---
    await api('PATCH', `/budgets/${budget.id}`, { status: 'CANCELLED' })

    // The INTERMEDIATE state, asserted on purpose: nothing has re-read the
    // list, so the form still offers — and still holds — a pick the API will
    // refuse. A spec that waited for the transition to settle here would be
    // measuring the settled world, not the window.
    await expect(select).toBeVisible()
    await expect(select.locator('option')).toHaveCount(2)
    expect(await select.inputValue()).toBe(budget.id)

    // --- t2: submit the stale state ---
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/patients/${id}/payments`)
    )
    await dialog.getByRole('button', { name: /guardar/i }).click()
    const res = await response
    // The request really left the client with the stale reservation on it:
    // the client-side schema validates against the options it loaded at t0.
    // Soft from here on: every post-submit claim is evaluated and reported
    // even when an earlier one fails, so a broken build cannot hide which of
    // them the defect reached (a set of assertions can be jointly blind).
    expect.soft(res.request().postDataJSON().budgetId).toBe(budget.id)
    expect.soft(res.status()).toBe(400)

    // User-visible outcome: the reason, not a silent swallow, and the form
    // stays open instead of pretending the entrega was recorded.
    await expect.soft(page.getByText(/already completed or cancelled/i)).toBeVisible()
    await expect.soft(dialog).toBeVisible()

    // The form has re-read the world: the option is gone, the pick is cleared,
    // and the absence is explained with the all-closed reason (not "no budgets",
    // which would be a different instruction to the operator).
    await expect.soft(dialog.locator('#payment-budget')).toHaveCount(0)
    await expect.soft(dialog.getByTestId('payment-budget-all-closed')).toBeVisible()
    await expect.soft(dialog.getByTestId('payment-budget-no-budgets')).toHaveCount(0)
    await page.screenshot({ path: shot('guard4-after-refusal'), fullPage: true })

    // Nothing was written: neither a reserved entrega nor a general one.
    expect.soft(await paymentCount(id)).toBe(0)
    await expect.soft(page.getByText('No hay entregas registradas')).toBeVisible()
  })

  test('a patient with no budget at all explains THAT absence instead', async ({
    authedPage: page,
  }) => {
    const lastName = `SinPresu${Date.now()}`
    const id = await createPatient(lastName)

    await openEntregas(page, id, lastName)
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    const dialog = page.getByRole('dialog')

    await expect(dialog.getByTestId('payment-budget-no-budgets')).toBeVisible()
    await expect(dialog.getByTestId('payment-budget-all-closed')).toHaveCount(0)
    await expect(dialog.locator('#payment-budget')).toHaveCount(0)
    await page.screenshot({ path: shot('part3-no-budgets'), fullPage: true })
  })
})

// ============================================================================
// Part 2 — the statement names the budget that holds the reservation
// ============================================================================
test.describe('Task #571: the held-advances block (statement)', () => {
  test('one open budget holding money: the block names it by its date and prints the API’s own held total', async ({
    authedPage: page,
  }) => {
    const lastName = `Reservado${Date.now()}`
    const id = await createPatient(lastName)
    const budget = await createBudget(id, 'APPROVED', 2500)
    await api('POST', `/patients/${id}/payments`, {
      amount: 800,
      date: new Date().toISOString(),
      budgetId: budget.id,
    })

    await openEntregas(page, id, lastName)

    const block = page.getByTestId('statement-held-advances')
    await expect(block).toBeVisible()
    await expect(page.getByTestId('statement-held-total')).toContainText(/800/)

    const rows = page.getByTestId('statement-held-budget-row')
    await expect(rows).toHaveCount(1)
    const rowText = (await rows.first().textContent()) ?? ''
    // Named, not the generic fallback wording.
    expect(rowText).toMatch(/^Presupuesto del /)
    expect(rowText).not.toContain('Presupuesto reservado')
    // In the app's own short format — "14 oct 2026" — never the browser's
    // numeric default ("14/10/2026"), which is what an unlocalised
    // toLocaleDateString() renders here.
    const expected = await page.evaluate(
      ([iso, locale]) =>
        new Date(iso).toLocaleDateString(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      [budget.createdAt, 'es'] as const
    )
    expect.soft(rowText).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    expect.soft(rowText).toContain(expected)
    await page.screenshot({ path: shot('part2-held-block'), fullPage: true })
  })
})

// ============================================================================
// Part 1 — the picker's option label follows the app language, not the browser
// ============================================================================
test.describe('Task #571: the picker option label', () => {
  test('reads as a short localised date, not as the browser’s numeric default', async ({
    authedPage: page,
  }) => {
    const lastName = `Etiqueta${Date.now()}`
    const id = await createPatient(lastName)
    const budget = await createBudget(id, 'APPROVED', 1750)

    await openEntregas(page, id, lastName)
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    const dialog = page.getByRole('dialog')
    const option = dialog.locator('#payment-budget option').nth(1)
    await expect(option).toHaveCount(1)

    const label = (await option.textContent()) ?? ''
    const expected = await page.evaluate(
      ([iso, locale]) =>
        new Date(iso).toLocaleDateString(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      [budget.createdAt, 'es'] as const
    )
    // A numeric dd/mm/yyyy here is the unlocalised default leaking back in.
    expect.soft(label).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    expect.soft(label).toContain(expected)
    await page.screenshot({ path: shot('part1-option-label'), fullPage: true })
  })

  /**
   * Known blind spot carried from the unit layer: in Arabic, month 'short' and
   * month 'long' render the SAME string, so an ar-only assertion cannot tell a
   * short-format regression from a long-format one. This measures that claim in
   * the browser's own ICU rather than in Node's, and goes red if a Chromium ICU
   * update ever makes them differ — at which point an ar case becomes as
   * discriminating as the es/en ones.
   */
  test('browser ICU: Arabic short and long months coincide (es/en do not)', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    const probe = await page.evaluate(() => {
      const d = new Date('2026-10-14T12:00:00Z')
      const fmt = (locale: string, month: 'short' | 'long') =>
        d.toLocaleDateString(locale, { day: 'numeric', month, year: 'numeric' })
      return ['es', 'en', 'ar'].map((l) => ({
        locale: l,
        short: fmt(l, 'short'),
        long: fmt(l, 'long'),
      }))
    })
    const by = Object.fromEntries(probe.map((p) => [p.locale, p]))
    expect(by.es.short).not.toBe(by.es.long)
    expect(by.en.short).not.toBe(by.en.long)
    expect(by.ar.short).toBe(by.ar.long)
  })
})
