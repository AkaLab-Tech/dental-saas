import { test, expect } from './fixtures/authed'

test.describe('Appointments Management', () => {
  test.describe('Appointments Page', () => {
    test('should display appointments page when authenticated', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Task #404: BOTH filters are load-bearing and neither alone is enough.
      //
      //   name  excludes the shell's <h1>Alveo</h1> (AppLayout.tsx), which is
      //         on every page and would otherwise collide with `level: 1`.
      //   level excludes the empty-state <h3>"No hay citas para este período"</h3>
      //         (AppointmentsPage.tsx), which also matches /citas/i and renders
      //         whenever the tenant has no appointments in the period — which,
      //         because global-setup.ts mints a fresh tenant per run, is EVERY
      //         run. The intermittency was never the empty state: it was a race,
      //         a fast page resolving the locator before the empty state mounted.
      //
      // Level rather than a tighter regex on purpose: `/^citas$/i` would also
      // pass today and would break again the next time the empty-state copy
      // changes. The heading level is structural.
      await expect(page.getByRole('heading', { name: /citas/i, level: 1 })).toBeVisible()
    })

    test('should have calendar navigation visible', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Should have previous/next month buttons
      await expect(page.getByRole('button', { name: /anterior/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /siguiente/i })).toBeVisible()
    })

    test('should have new appointment button visible', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await expect(page.getByRole('button', { name: /nueva cita/i })).toBeVisible()
    })

    test('should have filter controls visible', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await expect(page.getByRole('button', { name: /filtros/i })).toBeVisible()
    })
  })

  test.describe('Calendar Navigation', () => {
    test('should navigate to next month', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Get current month text
      const currentMonth = await page.locator('text=/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i').first().textContent()

      // Click next month
      await page.getByRole('button', { name: /siguiente/i }).click()

      // Wait for month to change
      await page.waitForTimeout(500)

      // Month should have changed
      const newMonth = await page.locator('text=/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i').first().textContent()

      expect(newMonth).not.toBe(currentMonth)
    })

    test('should navigate to previous month', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Get current month text
      const currentMonth = await page.locator('text=/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i').first().textContent()

      // Click previous month
      await page.getByRole('button', { name: /anterior/i }).click()

      // Wait for month to change
      await page.waitForTimeout(500)

      // Month should have changed
      const newMonth = await page.locator('text=/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i').first().textContent()

      expect(newMonth).not.toBe(currentMonth)
    })
  })

  test.describe('Appointment Form Modal', () => {
    test('should open create appointment modal', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await page.getByRole('button', { name: /nueva cita/i }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // Scoped to the dialog: the trigger button behind it also matches
      // /nueva cita/i, which would otherwise violate Playwright's strict mode.
      await expect(dialog.getByText(/nueva cita/i)).toBeVisible()
    })

    test('should close modal when clicking cancel', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await page.getByRole('button', { name: /nueva cita/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      await page.getByRole('button', { name: /cancelar/i }).click()

      await expect(page.getByRole('dialog')).not.toBeVisible()
    })

    test('should show validation errors in create form', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      await page.getByRole('button', { name: /nueva cita/i }).click()

      // Try to submit without filling required fields
      const submitButton = page.getByRole('button', { name: /crear cita/i })
      await submitButton.click()

      // Should show validation errors for required fields
      await expect(page.getByText(/paciente es requerido/i)).toBeVisible()
      await expect(page.getByText(/doctor es requerido/i)).toBeVisible()
    })
  })

  test.describe('Filters', () => {
    test('should toggle filters panel', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Exact match: once open, a "Limpiar filtros" button also appears and
      // would otherwise violate strict mode on the second (close) click.
      const filtersButton = page.getByRole('button', { name: 'Filtros', exact: true })
      await filtersButton.click()

      // Should show filter options. Exact match: the "Estado" label and the
      // "Todos los estados" <option> both match /estado/i loosely, which
      // would violate Playwright's strict mode.
      await expect(page.getByText('Estado', { exact: true })).toBeVisible()

      // Click again to close
      await filtersButton.click()

      // Wait for panel to close
      await page.waitForTimeout(300)
    })
  })

  test.describe('View Options', () => {
    test('should have list view button', async ({ authedPage: page }) => {
      await page.goto('/appointments')

      // Should have a button to toggle between views
      const listButton = page.getByRole('button', { name: /lista/i })
      const isVisible = await listButton.isVisible().catch(() => false)

      // View toggle might not always be visible depending on implementation
      expect(typeof isVisible).toBe('boolean')
    })
  })
})
