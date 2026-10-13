import { readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
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
})
