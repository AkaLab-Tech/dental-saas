import { readFileSync } from 'fs'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

/**
 * Patient record header shows debt and credit (task #526).
 *
 * The credit figure used to live only inside the Entregas tab. This spec
 * proves, in a real browser against the real API, that on a FRESH load of the
 * record the figures are visible with zero tab clicks, and that a neutral
 * zero state renders (not a blank gap) for a patient with no payments.
 */
test.describe('Patient header balance (#526)', () => {
  test('shows debt and credit in the header on open, without opening any tab', async ({
    authedPage: page,
  }) => {
    const uniqueLastName = `Saldo${Date.now()}`

    // --- Seed a competing patient that sorts AHEAD of this run's own ---
    // PatientsListView sorts client-side by "firstName lastName" and every e2e
    // patient is firstName "E2E", so "AAA ..." is the first row of the
    // unfiltered list. A spec that takes the first row opens this one.
    const createPatient = async (firstName: string, lastName: string) => {
      await page.getByRole('button', { name: /nuevo paciente/i }).click()
      const patientDialog = page.getByRole('dialog')
      await expect(patientDialog).toBeVisible()
      await page.getByPlaceholder('Juan').fill(firstName)
      await page.getByPlaceholder('Pérez').fill(lastName)
      const created = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/patients$/.test(r.url())
      )
      await patientDialog.getByRole('button', { name: /crear paciente/i }).click()
      const id = (await (await created).json()).data.id as string
      await expect(patientDialog).not.toBeVisible()
      return id
    }

    await page.goto('/patients')
    await createPatient('AAA', `Previo${Date.now()}`)
    const ownPatientId = await createPatient('E2E', uniqueLastName)

    // Never `.first()` of the list: it takes whatever row the client-side sort
    // put on top, which is a different patient. The search is a debounced
    // refetch, so the list is unfiltered until it lands; the unique name is
    // in both the unfiltered and the filtered list, so matching the row by
    // that text resolves to this run's patient either way. toHaveCount(1)
    // asserts the match is unambiguous. It need not wait for the refetch only
    // while the tenant fits the default page (patient.service.ts listPatients:
    // limit = 50, take: Math.min(limit, 100), lastName asc); past that the
    // row can be absent from the stale page and this retrying assertion waits
    // for the filtered refetch. The pin holds either way.
    await page.getByPlaceholder(/buscar por nombre/i).fill(uniqueLastName)
    const patientRow = page.getByRole('row').filter({ hasText: uniqueLastName })
    await expect(patientRow).toHaveCount(1)
    await patientRow.getByRole('link', { name: /ver ficha/i }).click()
    await expect(page).toHaveURL(/\/patients\/[a-zA-Z0-9-]+/)

    // Prove which record opened before recording anything on it. The shell
    // renders <h1>Alveo</h1> on every page, so name AND level are needed.
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueLastName), level: 1 })
    ).toBeVisible()

    const balance = page.getByTestId('patient-balance')

    // --- Case 3: neutral zero state, not a blank gap ---
    // Wait for the resolved value: the placeholder is an em dash while loading.
    await expect(balance).toContainText(/Deuda por consultas realizadas:\s*\D*0[.,]00/)
    await expect(balance).toContainText(/Saldo a favor:\s*\D*0[.,]00/)
    await expect(balance).not.toContainText('—')

    // --- Record an advance payment of 500 (becomes credit) ---
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    await tabs.getByRole('button', { name: 'Entregas' }).click()
    await page.getByRole('button', { name: /nueva entrega/i }).click()
    const paymentDialog = page.getByRole('dialog')
    await expect(paymentDialog).toBeVisible()
    await paymentDialog.getByLabel(/monto/i).fill('500')
    await paymentDialog.getByRole('button', { name: /guardar/i }).click()
    await expect(paymentDialog).not.toBeVisible()

    // --- Case 1: genuinely fresh load, NO tab click ---
    await page.reload()
    await expect(page).toHaveURL(/\/patients\/[a-zA-Z0-9-]+/)

    const freshBalance = page.getByTestId('patient-balance')
    await expect(freshBalance).toBeVisible()
    await expect(freshBalance).toBeInViewport()
    // Resolved real amount computed by the API (500 of credit, no debt).
    await expect(freshBalance).toContainText(/Saldo a favor:\s*\D*500[.,]00/)
    await expect(freshBalance).toContainText(/Deuda por consultas realizadas:\s*\D*0[.,]00/)
    await expect(freshBalance).not.toContainText('—')

    // The 500 landed on THIS run's patient, read back by the id
    // the API returned when it was created (not the id in the URL, which would
    // follow a wrong-record open and make this check vacuous).
    const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
    const response = await page.request.get(
      `${API_BASE_URL}/api/patients/${ownPatientId}/balance`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    expect(response.ok()).toBe(true)
    expect((await response.json()).data.credit).toBe(500)

    const creditText = (await freshBalance.textContent()) ?? ''
    console.log(`PATIENT_BALANCE_TEXT: ${creditText}`)

    await page.screenshot({
      path: '.task-log/screenshots/patient-header-balance.png',
      fullPage: true,
    })
  })
})
