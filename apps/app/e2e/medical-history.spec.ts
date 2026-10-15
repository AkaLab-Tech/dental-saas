import { readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

// `__dirname` does not exist here: this package is "type": "module", so the
// bare identifier throws at module load and Playwright reports 0 tests in 0
// files - the whole e2e suite, not just this spec. `global-setup.ts` derives it
// the same way. Note the throw is reachable only when E2E_SHOT_DIR is unset,
// which is how it passed locally and failed in CI.
const here = path.dirname(fileURLToPath(import.meta.url))

const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? path.resolve(here, '../test-results/medical-history-shots')

type Entry = { text: string; criticality: 'critical' | 'normal' }
type History = Partial<
  Record<'allergies' | 'currentMedication' | 'conditions' | 'previousSurgeries' | 'medicalNotes', Entry[]>
>

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

// Synthetic fixture names only; the suffix keeps each patient distinct.
async function createPatient(label: string, history?: History): Promise<string> {
  const created = await api('POST', '/patients', { firstName: 'E2E', lastName: `Historial ${label}` })
  const id: string = created.id ?? created.data?.id ?? created.patient?.id
  if (!id) throw new Error(`could not read patient id from ${JSON.stringify(created)}`)
  if (history) await api('PUT', `/patients/${id}/medical-history`, history)
  return id
}

test.describe('Patient record medical history', () => {
  test.beforeAll(() => mkdirSync(SHOT_DIR, { recursive: true }))

  test.afterEach(async ({ authedPage: page }, testInfo) => {
    const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80)
    await page.screenshot({ path: path.join(SHOT_DIR, `${slug}-${testInfo.status}.png`), fullPage: true })
  })

  test('populated record shows critical allergy and condition on opening, without clicking', async ({
    authedPage: page,
  }) => {
    const id = await createPatient('populated', {
      allergies: [{ text: 'Penicilina', criticality: 'critical' }],
      conditions: [{ text: 'Paciente renal', criticality: 'normal' }],
    })
    await page.goto(`/patients/${id}`)

    const block = page.getByTestId('medical-history-block')
    await expect(block).toHaveCount(1)
    await expect(block.getByText('Penicilina')).toBeVisible()
    await expect(block.getByText('Paciente renal')).toBeVisible()
    await expect(block.getByRole('heading', { name: 'Historial Médico', level: 3 })).toBeVisible()

    const allergy = page.locator('[data-testid="medical-history-section-allergies"] li')
    const condition = page.locator('[data-testid="medical-history-section-conditions"] li')
    await expect(allergy).toHaveAttribute('data-criticality', 'critical')
    await expect(allergy.getByText('Crítico', { exact: true })).toHaveCount(1)
    await expect(condition).toHaveAttribute('data-criticality', 'normal')
    await expect(condition.getByText('Crítico', { exact: true })).toHaveCount(0)
  })

  test('one critical entry among six routine notes reads as exactly one critical', async ({
    authedPage: page,
  }) => {
    const routine: Entry[] = Array.from({ length: 6 }, (_, i) => ({
      text: `Nota de rutina ${i + 1}`,
      criticality: 'normal' as const,
    }))
    const id = await createPatient('escalation', {
      medicalNotes: [...routine.slice(0, 3), { text: 'Anticoagulado', criticality: 'critical' }, ...routine.slice(3)],
    })
    await page.goto(`/patients/${id}`)

    const section = page.getByTestId('medical-history-section-medicalNotes')
    await expect(section.locator('li')).toHaveCount(7)
    await expect(section.locator('[data-criticality="critical"]')).toHaveCount(1)
    await expect(section.locator('[data-criticality="normal"]')).toHaveCount(6)
    await expect(section.getByText('Crítico', { exact: true })).toHaveCount(1)
    await expect(section.locator('[data-criticality="critical"]')).toContainText('Anticoagulado')
  })

  test('patient with no history shows nothing at all in that area', async ({ authedPage: page }) => {
    const id = await createPatient('empty')
    const historyLoaded = page.waitForResponse(
      (r) => r.url().includes(`/patients/${id}/medical-history`) && r.request().method() === 'GET'
    )
    await page.goto(`/patients/${id}`)
    await historyLoaded
    // The record itself has rendered, so the absence below is not a loading state.
    await expect(page.getByRole('heading', { name: 'E2E Historial empty', level: 1 })).toBeVisible()

    await expect(page.locator('[data-testid="medical-history-block"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="medical-history-section-"]')).toHaveCount(0)
    await expect(page.locator('[data-criticality]')).toHaveCount(0)
    await expect(page.getByText('Crítico')).toHaveCount(0)
    for (const heading of ['Historial Médico', 'Alergias', 'Medicación actual', 'Condiciones', 'Cirugías previas', 'Notas médicas']) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0)
    }
  })

  test('adding an entry through the UI shows it after save', async ({ authedPage: page }) => {
    const id = await createPatient('edit', {
      conditions: [{ text: 'Paciente renal', criticality: 'normal' }],
    })
    await page.goto(`/patients/${id}`)

    const section = page.getByTestId('medical-history-section-conditions')
    await expect(section.getByText('Paciente renal')).toBeVisible()
    await section.getByRole('button', { name: 'Editar: Condiciones' }).click()
    await section.getByRole('button', { name: 'Agregar entrada' }).click()
    await section.getByLabel('Entrada 2').fill('Hipertensión controlada')
    await section.getByRole('button', { name: 'Guardar' }).click()

    await expect(section.getByText('Hipertensión controlada')).toBeVisible()
    await expect(section.locator('li')).toHaveCount(2)
    await expect(section.getByRole('button', { name: 'Guardar' })).toHaveCount(0)
  })
  // The record's own "Editar" link, then the modal the patients page mounts
  // from the `edit` query param. Returns the dialog and the medical section.
  async function openEditFromRecord(page: Page, id: string, heading: string) {
    const historyLoaded = page.waitForResponse(
      (r) => r.url().includes(`/patients/${id}/medical-history`) && r.request().method() === 'GET'
    )
    await page.goto(`/patients/${id}`)
    await historyLoaded
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    return historyLoaded
  }

  // Opens the Edit modal from the patients LIST row (search, then the row's
  // "Editar" button). Used by tests that are not about the record's own link;
  // the record link (`/patients?edit=<id>`) is exercised by openModalFromRecord.
  async function openModal(page: Page, label: string) {
    await page.goto('/patients')
    await page.getByPlaceholder(/buscar/i).fill(`E2E Historial ${label}`)
    const row = page.getByRole('row').filter({ hasText: `E2E Historial ${label}` })
    await row.getByRole('button', { name: 'Editar', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Editar Paciente', level: 2 })).toBeVisible()
    return dialog
  }

  // Opens the Edit modal the way a user does from the record: the record's own
  // "Editar" link navigates to /patients?edit=<id>, and the patients page mounts
  // the modal for that id.
  async function openModalFromRecord(page: Page, id: string, name: string) {
    await openEditFromRecord(page, id, name)
    await page.getByRole('link', { name: 'Editar', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/patients\\?edit=${id}$`))
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Editar Paciente', level: 2 })).toBeVisible()
    return dialog
  }

  async function shot(page: Page, name: string) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true })
  }

  test.describe('Edit modal entry point', () => {
    test('first entry created through the Edit modal shows in the record body (empty -> modal -> populated)', async ({
      authedPage: page,
    }) => {
      const id = await createPatient('roundtrip')
      const name = 'E2E Historial roundtrip'

      // Empty end: the record shows nothing in the medical area.
      await openEditFromRecord(page, id, name)
      await expect(page.locator('[data-testid="medical-history-block"]')).toHaveCount(0)
      await expect(page.locator('[data-testid^="medical-history-section-"]')).toHaveCount(0)
      await expect(page.getByText('Penicilina')).toHaveCount(0)
      await shot(page, 'roundtrip-1-record-empty')

      // Entry point: the record's own "Editar" link, then all five sections on an empty history.
      const dialog = await openModalFromRecord(page, id, name)
      const edit = dialog.getByTestId('medical-history-edit')
      await expect(edit.getByRole('heading', { name: 'Historial Médico', level: 3 })).toBeVisible()
      for (const label of ['Alergias', 'Medicación actual', 'Condiciones', 'Cirugías previas', 'Notas médicas']) {
        await expect(edit.getByRole('heading', { name: label, level: 4, exact: true })).toBeVisible()
      }
      // The modal body scrolls internally, so a full-page frame would miss the sections.
      await edit.getByRole('heading', { name: 'Notas médicas', level: 4, exact: true }).scrollIntoViewIfNeeded()
      await shot(page, 'roundtrip-2-modal-five-sections-empty')

      const allergies = dialog.getByTestId('medical-history-section-allergies')
      await allergies.getByRole('button', { name: 'Editar: Alergias' }).click()
      await allergies.getByRole('button', { name: 'Agregar entrada' }).click()
      await allergies.getByLabel('Entrada 1').fill('Penicilina')
      await allergies.getByLabel('Criticidad').selectOption('critical')
      const saved = page.waitForResponse(
        (r) => r.url().includes(`/patients/${id}/medical-history`) && r.request().method() === 'PUT'
      )
      await allergies.getByRole('button', { name: 'Guardar', exact: true }).click()
      expect((await saved).ok()).toBe(true)
      await expect(allergies.getByText('Penicilina')).toBeVisible()
      await expect(allergies.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0)
      await allergies.scrollIntoViewIfNeeded()
      await shot(page, 'roundtrip-3-modal-entry-saved')

      // Populated end: back on the record, the entry is in the body.
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).not.toHaveURL(/edit=/)
      await openEditFromRecord(page, id, name)
      const block = page.getByTestId('medical-history-block')
      await expect(block).toHaveCount(1)
      const item = block.getByTestId('medical-history-section-allergies').locator('li')
      await expect(item).toHaveText(/Penicilina/)
      await expect(item).toHaveAttribute('data-criticality', 'critical')
      await shot(page, 'roundtrip-4-record-populated')
    })

    test('Enter in a medical entry input does not submit the patient form (real keypress)', async ({
      authedPage: page,
    }) => {
      const id = await createPatient('enter')
      const writes: string[] = []
      page.on('request', (r) => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && r.url().includes('/api/patients')) {
          writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
        }
      })
      const dialog = await openModal(page, 'enter')

      const conditions = dialog.getByTestId('medical-history-section-conditions')
      await conditions.getByRole('button', { name: 'Editar: Condiciones' }).click()
      await conditions.getByRole('button', { name: 'Agregar entrada' }).click()
      const input = conditions.getByLabel('Entrada 1')
      await input.fill('Paciente renal')
      await input.press('Enter')

      // Implicit submission is synchronous with the keypress; the settle only
      // gives a (wrongly) triggered async handler time to reach the network.
      await page.waitForTimeout(750)
      await expect(dialog).toBeVisible()
      await expect(input).toHaveValue('Paciente renal')
      await expect(page.getByText(/actualizado/i)).toHaveCount(0)
      expect(writes).toEqual([])
      await shot(page, 'enter-1-modal-still-open')

      // Positive control: the same keypress in a patient-form input DOES submit,
      // so the absence above is the guard working, not Enter being inert here.
      await dialog.getByPlaceholder('Pérez').press('Enter')
      await expect(dialog).toHaveCount(0)
      expect(writes).toContain(`PUT /api/patients/${id}`)
    })

    // The record's "Editar" link goes to /patients?edit=<id>; the patients page
    // reads the `edit` param and opens the Edit modal for that patient. Closing
    // the modal clears the param, so a reload does not reopen it.
    test('the record "Editar" link opens the Edit modal and closing it clears ?edit', async ({
      authedPage: page,
    }) => {
      const id = await createPatient('link')
      const dialog = await openModalFromRecord(page, id, 'E2E Historial link')
      await shot(page, 'link-1-modal-open-from-record')

      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).not.toHaveURL(/edit=/)

      await page.reload()
      await expect(page.getByRole('heading', { name: 'Pacientes', level: 1 })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page).not.toHaveURL(/edit=/)
    })

    test('a MEDICAL_HISTORY_UPDATE holder sees all five section labels in the modal on an empty history', async ({
      authedPage: page,
    }) => {
      await createPatient('labels')
      const dialog = await openModal(page, 'labels')
      const sections = dialog.locator('[data-testid^="medical-history-section-"]')
      await expect(sections).toHaveCount(5)
      for (const label of ['Alergias', 'Medicación actual', 'Condiciones', 'Cirugías previas', 'Notas médicas']) {
        await expect(dialog.getByRole('heading', { name: label, level: 4, exact: true })).toBeVisible()
      }
      // Empty sections offer "Agregar", never a populated list.
      await expect(dialog.getByText('Agregar', { exact: true })).toHaveCount(5)
      await expect(dialog.locator('[data-criticality]')).toHaveCount(0)
    })

    test('the demographic save still works through the restructured footer (form association)', async ({
      authedPage: page,
    }) => {
      const id = await createPatient('footer')
      const dialog = await openModal(page, 'footer')

      await dialog.getByPlaceholder('Pérez').fill('Historial footer guardado')
      const saved = page.waitForResponse(
        (r) => r.url().endsWith(`/api/patients/${id}`) && r.request().method() === 'PUT'
      )
      await dialog.getByRole('button', { name: 'Guardar Cambios', exact: true }).click()
      expect((await saved).ok()).toBe(true)
      await expect(dialog).toHaveCount(0)

      const fetched = await api('GET', `/patients/${id}`)
      const patient = fetched.data ?? fetched.patient ?? fetched
      expect(patient.lastName).toBe('Historial footer guardado')
    })
  })
})
