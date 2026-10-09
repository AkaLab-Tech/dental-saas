import { test, expect } from './fixtures/authed'

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

    // --- Seed a patient via the UI ---
    await page.goto('/patients')
    await page.getByRole('button', { name: /nuevo paciente/i }).click()
    const patientDialog = page.getByRole('dialog')
    await expect(patientDialog).toBeVisible()
    await page.getByPlaceholder('Juan').fill('E2E')
    await page.getByPlaceholder('Pérez').fill(uniqueLastName)
    await patientDialog.getByRole('button', { name: /crear paciente/i }).click()
    await expect(patientDialog).not.toBeVisible()

    await page.getByPlaceholder(/buscar por nombre/i).fill(uniqueLastName)
    const viewRecordLink = page.getByRole('link', { name: /ver ficha/i }).first()
    await expect(viewRecordLink).toBeVisible()
    await viewRecordLink.click()
    await expect(page).toHaveURL(/\/patients\/[a-zA-Z0-9-]+/)

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

    const creditText = (await freshBalance.textContent()) ?? ''
    console.log(`PATIENT_BALANCE_TEXT: ${creditText}`)

    await page.screenshot({
      path: '.task-log/screenshots/patient-header-balance.png',
      fullPage: true,
    })
  })
})
