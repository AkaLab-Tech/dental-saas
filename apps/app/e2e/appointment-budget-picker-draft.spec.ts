import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(__dirname, '../../../.task-log/screenshots')

/**
 * A DRAFT budget cannot be associated to an appointment (task #602).
 *
 * The appointment form's budget-item picker offers PENDING lines only from
 * APPROVED / PARTIAL budgets. When the patient has a DRAFT budget with
 * PENDING lines, they are hidden and a hint says why. The server enforces the
 * same rule (400 BUDGET_NOT_ASSOCIABLE), asserted here as the second layer.
 *
 * One synthetic patient carries both a DRAFT and an APPROVED budget, so the
 * same picker must hide one line and offer the other. Records are created
 * through the API with a per-run tag and the patient is picked by typing its
 * unique last name; no locator takes a list position.
 */

async function api(method: string, route: string, body?: unknown, allowFailure = false) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  const res = await fetch(`${API_BASE_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && !allowFailure) throw new Error(`${method} ${route} failed (${res.status}): ${JSON.stringify(json)}`)
  return { status: res.status, json, data: json.data ?? json }
}

async function seed(tag: string) {
  const lastName = `Draft${tag}`
  const patient = (await api('POST', '/patients', { firstName: 'E2E', lastName })).data
  const draft = (
    await api('POST', `/patients/${patient.id}/budgets`, {
      status: 'DRAFT',
      items: [{ description: `BorradorItem${tag}`, quantity: 1, unitPrice: 111 }],
    })
  ).data
  await api('POST', `/patients/${patient.id}/budgets`, {
    status: 'APPROVED',
    items: [{ description: `AprobadoItem${tag}`, quantity: 1, unitPrice: 222 }],
  })
  const doctor = (
    await api('POST', '/doctors', {
      firstName: 'E2E',
      lastName: `Doc${tag}`,
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    })
  ).data
  return {
    patientId: patient.id as string,
    lastName,
    draftItemId: draft.items[0].id as string,
    draftDescription: `BorradorItem${tag}`,
    approvedDescription: `AprobadoItem${tag}`,
    doctorId: doctor.id as string,
  }
}

test.describe('Appointment budget picker: DRAFT budgets are not associable (#602)', () => {
  test('hides the DRAFT budget line, shows the hint, offers the APPROVED line', async ({ authedPage: page }) => {
    const tag = `${Date.now()}`
    const s = await seed(tag)

    // Opened from the patient's own record (the patient is fixed by id), not
    // through the name search, so the spec does not depend on the search.
    await page.goto(`/patients/${s.patientId}`)
    await expect(page.getByRole('heading', { name: new RegExp(s.lastName), level: 1 })).toBeVisible()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Citas' }).click()
    await page.getByRole('button', { name: /nueva cita/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await expect(dialog.getByText('Ítems de presupuesto', { exact: true })).toBeVisible()
    // The APPROVED line proves the picker finished loading, so the absence
    // assertions below are not vacuous.
    await expect(dialog.getByText(s.approvedDescription, { exact: true })).toBeVisible()
    await expect(dialog.getByText(s.draftDescription, { exact: true })).toHaveCount(0)
    await expect(dialog.getByText(/presupuestos en borrador cuyos ítems no se ofrecen/i)).toBeVisible()

    await page.screenshot({ path: path.join(SHOTS, 'appointment-budget-picker-draft-hidden.png') })
  })

  test('the server refuses to associate the DRAFT budget line (400 BUDGET_NOT_ASSOCIABLE)', async () => {
    const tag = `${Date.now()}`
    const s = await seed(tag)

    const res = await api(
      'POST',
      '/appointments',
      {
        patientId: s.patientId,
        doctorId: s.doctorId,
        date: '2031-03-04',
        startTime: '2031-03-04T10:00:00.000Z',
        endTime: '2031-03-04T10:30:00.000Z',
        budgetItemIds: [s.draftItemId],
      },
      true
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.json)).toContain('BUDGET_NOT_ASSOCIABLE')
  })
})
