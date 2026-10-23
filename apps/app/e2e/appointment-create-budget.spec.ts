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
 * Create a budget from the appointment form (task #628).
 *
 * When the patient has no budget with associable items, the appointment form's
 * picker offers "Crear presupuesto". It opens the budget form nested over the
 * still-mounted appointment form (preset APPROVED); saving creates the budget
 * and the picker repopulates in place. Patients are synthetic, created through
 * the API with a per-run tag, and opened from their own record (by id); no
 * locator takes a list position.
 */

async function api(method: string, route: string, body?: unknown) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  const res = await fetch(`${API_BASE_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${JSON.stringify(json)}`)
  return json.data ?? json
}

async function createPatient(lastName: string) {
  return (await api('POST', '/patients', { firstName: 'E2E', lastName })).id as string
}

async function openNewAppointmentForm(page: Page, patientId: string, lastName: string) {
  await page.goto(`/patients/${patientId}`)
  await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Citas' }).click()
  await page.getByRole('button', { name: /nueva cita/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Ítems de presupuesto', { exact: true })).toBeVisible()
  return dialog
}

test.describe('Appointment form: create a budget when the patient has none (#628)', () => {
  test('creates the budget in place, keeps the typed notes, and the new item is selectable', async ({ authedPage: page }) => {
    const tag = `${Date.now()}`
    const lastName = `SinPres${tag}`
    const itemDescription = `ItemNuevo${tag}`
    const typedNotes = `Nota escrita antes de crear el presupuesto ${tag}`
    const patientId = await createPatient(lastName)

    const dialog = await openNewAppointmentForm(page, patientId, lastName)

    await expect(dialog.getByText('Este paciente no tiene ítems de presupuesto disponibles para asociar.')).toBeVisible()
    const notes = dialog.getByPlaceholder('Notas adicionales sobre la cita...')
    await notes.fill(typedNotes)
    await notes.scrollIntoViewIfNeeded()
    const createButton = dialog.getByRole('button', { name: 'Crear presupuesto' })
    await createButton.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(SHOTS, 'appointment-create-budget-1-button.png') })

    await createButton.click()
    const budgetHeading = page.getByRole('heading', { name: 'Nuevo Presupuesto', level: 2 })
    await expect(budgetHeading).toBeVisible()
    const budgetForm = page.locator('form').filter({ has: budgetHeading })
    // Preset to APPROVED (the only status whose items the picker offers).
    await expect(budgetForm.locator('select')).toHaveValue('APPROVED')
    await budgetForm.getByPlaceholder('Ej: Extracción molar superior').fill(itemDescription)
    await budgetForm.locator('input[type="number"]').last().fill('150')
    await page.screenshot({ path: path.join(SHOTS, 'appointment-create-budget-2-nested-form.png') })

    await budgetForm.getByRole('button', { name: 'Guardar' }).click()
    await expect(budgetHeading).toHaveCount(0)

    // Still the same appointment form, with exactly what was typed.
    await expect(dialog).toBeVisible()
    await expect(notes).toHaveValue(typedNotes)
    const row = dialog.locator('label').filter({ hasText: itemDescription })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Pendiente')
    const checkbox = row.getByRole('checkbox')
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(checkbox).toBeChecked()
    await expect(notes).toHaveValue(typedNotes)
    await expect(dialog.getByRole('button', { name: 'Crear presupuesto' })).toHaveCount(0)
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(SHOTS, 'appointment-create-budget-3-item-selectable.png') })
  })

  test('control: a patient with an APPROVED budget item does not see the button', async ({ authedPage: page }) => {
    const tag = `${Date.now()}`
    const lastName = `ConPres${tag}`
    const itemDescription = `ItemAprobado${tag}`
    const patientId = await createPatient(lastName)
    await api('POST', `/patients/${patientId}/budgets`, {
      status: 'APPROVED',
      items: [{ description: itemDescription, quantity: 1, unitPrice: 200 }],
    })

    const dialog = await openNewAppointmentForm(page, patientId, lastName)

    // The offered line proves the picker finished loading, so the absence
    // assertions below are not vacuous.
    await expect(dialog.getByText(itemDescription, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Crear presupuesto' })).toHaveCount(0)
    await expect(dialog.getByText('Este paciente no tiene ítems de presupuesto disponibles para asociar.')).toHaveCount(0)
    await dialog.getByText(itemDescription, { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(SHOTS, 'appointment-create-budget-4-control-no-button.png') })
  })
})
