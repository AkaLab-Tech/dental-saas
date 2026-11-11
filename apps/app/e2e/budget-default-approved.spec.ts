import { test, expect } from './fixtures/authed'
import {
  SHOTS,
  budgetStatusSelect,
  budgetWithExecutedLink,
  newPatient,
  readOptionValues,
} from './fixtures/budgets'

/**
 * #667: a budget is created APPROVED by default, and moving a budget with an
 * EXECUTED line back to DRAFT is refused (picker omits DRAFT; API 409
 * HAS_EXECUTED_ITEMS rendered as a translated message).
 * Each patient is synthetic with a unique name, opened by id; the budget is
 * pinned by its own id. No list position is used.
 *
 * `budgetWithExecutedLink` (shared with budget-status.spec.ts) executes the line
 * through a real appointment, the only route the server accepts since #675.
 */

test('budget create form defaults to APPROVED and persists APPROVED (#667)', async ({ authedPage: page }) => {
  const { patientId, lastName } = await newPatient('DefAprob')
  await page.goto(`/patients/${patientId}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()

  await page.getByRole('button', { name: /nuevo presupuesto/i }).first().click()
  const dialog = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Nuevo Presupuesto', level: 2 }) })
  await expect(dialog).toBeVisible()
  const statusSelect = dialog.getByLabel('Estado')
  await expect(statusSelect).toHaveValue('APPROVED')
  await expect(statusSelect.locator('option:checked')).toHaveText(/aprobado/i)
  await page.screenshot({ path: `${SHOTS}/667-create-form-defaults-approved.png`, fullPage: true })

  // Nothing chosen: saving must persist APPROVED, not DRAFT.
  await dialog.locator('input[name="items.0.description"]').fill('Tratamiento sintetico 667')
  await dialog.locator('input[name="items.0.unitPrice"]').fill('500')
  const postResp = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/patients/${patientId}/budgets`)
  )
  await dialog.getByRole('button', { name: /guardar|crear/i }).last().click()
  const body = await (await postResp).json()
  expect((body.data ?? body).status).toBe('APPROVED')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Estado' })).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: 'Estado' })).toHaveValue('APPROVED')
})

test('budget with an executed line: detail picker omits DRAFT, CANCELLED stays (#667)', async ({ authedPage: page }) => {
  const { patientId } = await newPatient('EjecSinBorr')
  const { budget } = await budgetWithExecutedLink(patientId, true)

  await page.goto(`/patients/${patientId}/budgets/${budget.id}`)
  await expect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  const sel = budgetStatusSelect(page)
  await expect(sel).toHaveCount(1)
  const values = await readOptionValues(sel)
  expect(values).not.toContain('DRAFT')
  expect(values).toContain('CANCELLED')
  await page.screenshot({ path: `${SHOTS}/667-detail-picker-omits-draft-executed.png`, fullPage: true })
})

test('stale picker: DRAFT on a budget executed meanwhile shows the translated refusal (#667)', async ({ authedPage: page }) => {
  const { patientId } = await newPatient('RefBorr')
  const { budget, markDone } = await budgetWithExecutedLink(patientId, false)
  await page.goto(`/patients/${patientId}`)
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()
  const cardSelect = page.getByRole('combobox', { name: 'Estado' })
  await expect(cardSelect).toHaveCount(1)
  await expect(cardSelect).toHaveValue('APPROVED')

  // Execute the line behind the page's back: the picker still offers DRAFT.
  await markDone()

  const patchResp = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/budgets/${budget.id}`)
  )
  await cardSelect.selectOption('DRAFT')
  const patch = await patchResp
  expect(patch.status()).toBe(409)
  expect((await patch.json()).code).toBe('HAS_EXECUTED_ITEMS')
  await expect(page.getByText(/No se puede volver a borrador/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/667-draft-refused-message.png`, fullPage: true })
})
