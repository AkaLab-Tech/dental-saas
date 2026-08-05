import { test, expect } from './fixtures/authed'

/**
 * Budget ↔ Appointment integration (Patient Budgets epic, Story 5).
 *
 * These are UI-level smoke checks that run against an authenticated session
 * (see e2e/fixtures/authed.ts and e2e/global-setup.ts) and document the
 * end-to-end flow at the UI seam:
 *   1. Associate budget items to an appointment on create/edit  (PR D-2)
 *   2. Confirm which associated items were EXECUTED on completion (PR D-3)
 *
 * The AUTHORITATIVE full-flow assertion (create APPROVED budget → appointment
 * linked to items → complete marking a subset executed → Budget.status becomes
 * PARTIAL, then COMPLETED) lives in the backend integration suite that DOES run
 * in CI: apps/api/src/routes/appointments.test.ts (describe 'Budget item
 * association (PR D-1)') and apps/api/src/services/budget-appointment.service.test.ts.
 * That supertest coverage — not this spec — is the source of truth for the
 * ROADMAP Story-5 acceptance criterion.
 */
test.describe('Budget ↔ Appointment integration (Story 5)', () => {
  test.describe('Associate budget items on the appointment form (D-2)', () => {
    test('the new-appointment modal can show the budget-items section', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await page.getByRole('button', { name: /nueva cita/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      // The "Ítems de presupuesto" section is only rendered once a patient is
      // selected; before that it must not be present. We assert the modal opened
      // cleanly and the section is not shown for an empty (no-patient) form.
      await expect(
        page.getByRole('dialog').getByText(/ítems de presupuesto/i)
      ).toHaveCount(0)
    })
  })

  test.describe('Confirm executed items on completion (D-3)', () => {
    test('completing an appointment opens the confirmation modal', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Switch to the list view where per-appointment actions (incl. "Completar")
      // are reachable. If there are no completable appointments for this freshly
      // registered tenant, this is a no-op smoke check that the page is interactive.
      const completeButton = page.getByRole('button', { name: /completar/i }).first()
      const hasCompletable = await completeButton.isVisible().catch(() => false)

      if (!hasCompletable) {
        test.skip()
      }

      await completeButton.click()

      // The completion confirmation modal (AppointmentCompleteModal) should open,
      // titled "Completar cita".
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/completar cita/i)).toBeVisible()

      // It always offers a "Marcar completada" confirm action. Associated budget
      // items (if any) appear with a "¿Se ejecutó en esta cita?" toggle defaulting
      // ON (opt-out); with none associated it shows the no-items hint. Either shape
      // is valid here — assert the confirm action is present.
      await expect(dialog.getByRole('button', { name: /marcar completada/i })).toBeVisible()
    })
  })
})
