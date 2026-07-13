import { test, expect } from './fixtures/authed'

test.describe('Patients Management', () => {
  test.describe('Patients List Page', () => {
    test('should display patients page when authenticated', async ({ authedPage: page }) => {
      await page.goto('/patients')

      // Exact match: a freshly-registered tenant has no patients, so the
      // empty state's "No hay pacientes" heading also renders and would
      // otherwise collide with a loose /pacientes/i match (strict mode).
      await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible()
    })

    test('should have search functionality visible', async ({ authedPage: page }) => {
      await page.goto('/patients')

      await expect(page.getByPlaceholder(/buscar/i)).toBeVisible()
    })

    test('should have new patient button visible', async ({ authedPage: page }) => {
      await page.goto('/patients')

      await expect(page.getByRole('button', { name: /nuevo paciente/i })).toBeVisible()
    })

    test('should have inactive-patients toggle visible', async ({ authedPage: page }) => {
      await page.goto('/patients')

      // PatientsPage no longer has a 'Filtros' button or gender filter — the
      // only filter control is this "Mostrar inactivos" checkbox.
      await expect(page.getByText(/mostrar inactivos/i)).toBeVisible()
    })
  })

  test.describe('Patient Form Modal', () => {
    test('should open create patient modal when clicking new patient button', async ({ authedPage: page }) => {
      await page.goto('/patients')

      await page.getByRole('button', { name: /nuevo paciente/i }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // Scoped to the dialog: the trigger button behind it also matches
      // /nuevo paciente/i, which would otherwise violate Playwright's strict mode.
      await expect(dialog.getByText(/nuevo paciente/i)).toBeVisible()
    })

    test('should close modal when clicking cancel', async ({ authedPage: page }) => {
      await page.goto('/patients')

      await page.getByRole('button', { name: /nuevo paciente/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      await page.getByRole('button', { name: /cancelar/i }).click()

      await expect(page.getByRole('dialog')).not.toBeVisible()
    })

    test('should show validation errors in create form', async ({ authedPage: page }) => {
      await page.goto('/patients')

      await page.getByRole('button', { name: /nuevo paciente/i }).click()

      // Try to submit without filling required fields
      const submitButton = page.getByRole('button', { name: /crear paciente/i })
      await submitButton.click()

      // Should show validation errors
      await expect(page.getByText(/nombre es requerido/i)).toBeVisible()
      await expect(page.getByText(/apellido es requerido/i)).toBeVisible()
    })
  })

  test.describe('Search and Filter', () => {
    test('should allow typing in search field', async ({ authedPage: page }) => {
      await page.goto('/patients')

      const searchInput = page.getByPlaceholder(/buscar/i)
      await searchInput.fill('John Doe')

      await expect(searchInput).toHaveValue('John Doe')
    })

    test('should toggle the inactive-patients checkbox', async ({ authedPage: page }) => {
      await page.goto('/patients')

      // No gender filter / filters panel exists anymore — the "Mostrar
      // inactivos" checkbox is the only filter to toggle.
      const inactiveCheckbox = page.getByRole('checkbox', { name: /mostrar inactivos/i })

      await expect(inactiveCheckbox).not.toBeChecked()

      await inactiveCheckbox.check()
      await expect(inactiveCheckbox).toBeChecked()

      await inactiveCheckbox.uncheck()
      await expect(inactiveCheckbox).not.toBeChecked()
    })
  })

  test.describe('Patient Details', () => {
    test('should navigate to patient detail when clicking on patient card', async ({ authedPage: page }) => {
      await page.goto('/patients')

      // Wait for any patient cards to load
      await page.waitForTimeout(1000)

      // Try to find a patient card (they have testid). A freshly registered
      // tenant has no patients, so this is a no-op smoke check in that case.
      const patientCard = page.locator('[data-testid^="patient-card-"]').first()

      const isVisible = await patientCard.isVisible().catch(() => false)

      if (isVisible) {
        await patientCard.click()

        // Should navigate to patient detail page
        await expect(page).toHaveURL(/\/patients\/[a-zA-Z0-9]+/)
      } else {
        // No patients to click
        test.skip()
      }
    })
  })
})
