import { test, expect } from './fixtures/authed'
import {
  SHOTS,
  api,
  apiRaw,
  budgetStatusSelect,
  budgetWithExecutedLink,
  getBudget,
  itemStatusSelect,
  newPatient,
  readOptionValues,
} from './fixtures/budgets'

/**
 * Budget status control on the card + status select on the create modal (#606),
 * and the item-edit status select that no longer offers EXECUTED (#675).
 * The patient is created through the API with a unique synthetic name and opened
 * by id; the budget is pinned by its own id (no list position is ever used).
 */

test('budget status: create with non-default status, change from the card, detail headings (#606)', async ({
  authedPage: page,
}) => {
  const { patientId, lastName } = await newPatient('EstadoPres')

  await page.goto(`/patients/${patientId}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Presupuestos' }).click()

  // Create form defaults to APPROVED (#667). The select must still be operable, so
  // an explicit DRAFT is chosen and then APPROVED again; the POST pins the budget id.
  await page.getByRole('button', { name: /nuevo presupuesto/i }).first().click()
  const dialog = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Nuevo Presupuesto', level: 2 }) })
  await expect(dialog).toBeVisible()
  const statusSelect = dialog.getByLabel('Estado')
  await expect(statusSelect).toHaveValue('APPROVED')
  await statusSelect.selectOption('DRAFT')
  await expect(statusSelect).toHaveValue('DRAFT')
  await statusSelect.selectOption('APPROVED')
  await expect(statusSelect).toHaveValue('APPROVED')
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

  // No executed lines: the detail page's status select offers APPROVED (and
  // DRAFT/CANCELLED, never PARTIAL/COMPLETED).
  const detailSelect = budgetStatusSelect(page)
  await expect(detailSelect).toHaveCount(1)
  await expect(detailSelect).toHaveValue('CANCELLED')
  const values = await readOptionValues(detailSelect)
  expect(values).toContain('APPROVED')
  expect(values).toContain('DRAFT')
  expect(values).not.toContain('PARTIAL')
  expect(values).not.toContain('COMPLETED')
  await page.screenshot({ path: `${SHOTS}/606-detail-select-offers-approved.png`, fullPage: true })
})

test('budget status: detail select hides APPROVED and DRAFT once a line is executed (#606, #667)', async ({ authedPage: page }) => {
  const { patientId } = await newPatient('EstadoEjec')
  // The precondition used to be a linkless DRAFT budget whose item was PATCHed to
  // EXECUTED; #675 refuses that transition (409 ITEM_EXECUTED_REQUIRES_LINK), so the
  // line is now executed the only way the server accepts — through an appointment.
  // That recipe needs an *associable* budget, so this budget is APPROVED on creation
  // and derives COMPLETED once its only active line is executed; it is never DRAFT.
  // The assertion is unaffected: getSettableBudgetStatuses drops APPROVED and DRAFT
  // when any active line is EXECUTED, which does not consult the budget's own status.
  const { budget } = await budgetWithExecutedLink(patientId, true)
  const executed = await getBudget(budget.id)
  expect(executed.status).toBe('COMPLETED')
  expect(executed.items.map((i: { status: string }) => i.status)).toEqual(['EXECUTED'])

  await page.goto(`/patients/${patientId}/budgets/${budget.id}`)
  await expect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  const detailSelect = budgetStatusSelect(page)
  await expect(detailSelect).toHaveCount(1)
  const values = await readOptionValues(detailSelect)
  expect(values).not.toContain('APPROVED')
  // #667: reverting a budget with an executed line to DRAFT is refused, so the picker omits it.
  expect(values).not.toContain('DRAFT')
  expect(values).toContain('CANCELLED')
  await page.screenshot({ path: `${SHOTS}/606-detail-select-hides-approved-executed.png`, fullPage: true })
})

test('budget item edit: the status select does not offer EXECUTED, and the API refuses it (#675)', async ({
  authedPage: page,
}) => {
  const { patientId } = await newPatient('ItemEjecSinCita')
  const b = await api('POST', `/patients/${patientId}/budgets`, {
    items: [{ description: 'Linea sin cita 675', quantity: 1, unitPrice: 500 }],
  })
  const budget = b.data ?? b
  const itemId: string = budget.items[0].id

  // The reason the option is gone: with no EXECUTED appointment link the server
  // refuses the transition, so offering it could only produce a dead end.
  const refused = await apiRaw('PATCH', `/budgets/${budget.id}/items/${itemId}`, {
    status: 'EXECUTED',
  })
  expect(refused.status).toBe(409)
  expect((await refused.json()).code).toBe('ITEM_EXECUTED_REQUIRES_LINK')

  await page.goto(`/patients/${patientId}/budgets/${budget.id}`)
  await expect(page.getByRole('heading', { name: 'Detalles del presupuesto', level: 2 })).toBeVisible()
  await expect(itemStatusSelect(page)).toHaveCount(0)

  // The budget holds exactly one item, so there is exactly one per-item edit button;
  // asserting the count first keeps the click off any other record's row.
  const editItem = page.getByRole('button', { name: 'Editar' })
  await expect(editItem).toHaveCount(1)
  await editItem.click()
  const select = itemStatusSelect(page)
  await expect(select).toHaveCount(1)
  const values = await readOptionValues(select)
  expect(values).toEqual(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED'])
  await expect(select.locator('option', { hasText: /^Ejecutado$/ })).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/675-item-edit-status-select-no-executed.png`, fullPage: true })
})
