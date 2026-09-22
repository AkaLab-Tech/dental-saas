import { test, expect } from './fixtures/authed'

/**
 * Payment Movements tab (task #453).
 *
 * A newest-first ledger of RECEIVED / REVERSED / CONVERTED_TO_ADVANCE /
 * RESTORED_TO_APPOINTMENT rows, gated on PAYMENTS_VIEW exactly like the
 * existing Payments ("Entregas") tab. This spec seeds a patient and a
 * payment through the real UI (no direct API calls — the authed fixture
 * only carries a session, not a request-signing helper), then verifies the
 * Movimientos tab renders the resulting RECEIVED row and does not surface
 * any FIFO-allocation text (`payment.appliedOf`, "Aplicado: ..."), which is
 * a Payments-tab-only concept that must never leak into this ledger.
 */
test.describe('Payment Movements tab (#453)', () => {
  test('shows a RECEIVED row after creating a payment, with no allocation text', async ({
    authedPage: page,
  }) => {
    const uniqueLastName = `Movimientos${Date.now()}`

    // --- Seed a patient via the UI ---
    await page.goto('/patients')

    await page.getByRole('button', { name: /nuevo paciente/i }).click()
    const patientDialog = page.getByRole('dialog')
    await expect(patientDialog).toBeVisible()

    await page.getByPlaceholder('Juan').fill('E2E')
    await page.getByPlaceholder('Pérez').fill(uniqueLastName)
    await patientDialog.getByRole('button', { name: /crear paciente/i }).click()
    await expect(patientDialog).not.toBeVisible()

    // --- Find the new patient and open its detail page ---
    await page.getByPlaceholder(/buscar por nombre/i).fill(uniqueLastName)
    const viewRecordLink = page.getByRole('link', { name: /ver ficha/i }).first()
    await expect(viewRecordLink).toBeVisible()
    await viewRecordLink.click()

    await expect(page).toHaveURL(/\/patients\/[a-zA-Z0-9-]+/)

    const tabs = page.getByRole('navigation', { name: 'Tabs' })

    // --- Record a payment (Entregas tab) ---
    await tabs.getByRole('button', { name: 'Entregas' }).click()
    await page.getByRole('button', { name: /nueva entrega/i }).click()

    const paymentDialog = page.getByRole('dialog')
    await expect(paymentDialog).toBeVisible()
    await paymentDialog.getByLabel(/monto/i).fill('150')
    await paymentDialog.getByRole('button', { name: /guardar/i }).click()
    await expect(paymentDialog).not.toBeVisible()

    // --- Open the Movimientos tab and assert the ledger ---
    await tabs.getByRole('button', { name: 'Movimientos' }).click()

    // The shell renders <h1>Alveo</h1> on every page, so the section
    // heading needs both name AND level to avoid ambiguity.
    await expect(page.getByRole('heading', { name: 'Movimientos', level: 2 })).toBeVisible()

    await page.screenshot({
      path: '.task-log/screenshots/payment-movements-tab.png',
      fullPage: true,
    })

    await expect(page.getByText(/entrega recibida/i)).toBeVisible()

    // No FIFO allocation text — that belongs to the Payments tab only
    // (payment.appliedOf: "Aplicado: {{paid}} de {{total}}").
    await expect(page.getByText(/aplicado:/i)).toHaveCount(0)
  })
})
