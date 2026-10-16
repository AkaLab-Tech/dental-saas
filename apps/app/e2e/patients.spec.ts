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
    test('should open the record of the patient whose "Ver ficha" link is clicked', async ({ authedPage: page }) => {
      // The list has no clickable row or card: the only way to a record is the
      // "Ver ficha" link in each row's action column. The test seeds its own
      // patient, so there is no empty-tenant case to skip.
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

      const uniqueLastName = `Detalle${Date.now()}`

      await page.goto('/patients')

      // A competing patient that sorts AHEAD of this run's own. The list is
      // displayed in the SERVER's order: family name, then given name. This
      // run's patient is family "Detalle<epoch>", so the competitor's family
      // name "Anterior<epoch>" sorts before it ("A" < "D") whatever the given
      // names are. What pins the record is its identity (the id check), not its
      // position: a test that takes the first row or the first "Ver ficha" link
      // opens the competitor and fails that check, whereas a competitor placed
      // AFTER the target would let `.first()` pass.
      const competingId = await createPatient('E2E', `Anterior${Date.now()}`)
      const ownId = await createPatient('E2E', uniqueLastName)
      expect(ownId).not.toBe(competingId)

      // Bind to the patient's identity (its unique last name), not to a
      // position. The rows are <tr>; the mobile cards are <div>s, so the
      // role=row filter cannot match the CSS-hidden second copy of the link.
      //
      // Deliberately NOT filtering with the search box: that search is a
      // SERVER-side refetch on a 300 ms debounce, and once it lands the list
      // holds this patient alone — at which point an unscoped `.first()` would
      // open the right record and the competing patient above would guard
      // nothing. Measured: with the debounce allowed to land, the pre-#567
      // `.first()` pattern passes. Reading the unfiltered list keeps the
      // competing row present at click time, so what resolves the row is the
      // scoping, not a race; toHaveCount(1) asserts the name is unambiguous.
      const patientRow = page.getByRole('row').filter({ hasText: uniqueLastName })
      await expect(patientRow).toHaveCount(1)

      await patientRow.getByRole('link', { name: /ver ficha/i }).click()

      // The exact id captured from POST /api/patients, not any patient's URL.
      await expect(page).toHaveURL(new RegExp(`/patients/${ownId}$`))
    })
  })
})
