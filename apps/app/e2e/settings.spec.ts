import { test, expect } from './fixtures/authed'

test.describe('Settings and Profile', () => {
  test.describe('Settings Page', () => {
    test('should display settings page when authenticated', async ({ authedPage: page }) => {
      await page.goto('/settings')

      await expect(page.getByRole('heading', { name: /configuración/i })).toBeVisible()
    })

    test('should have clinic settings section', async ({ authedPage: page }) => {
      await page.goto('/settings')

      // 'Información de la Clínica' is an unused i18n key — the actual
      // section heading is the 'Perfil de Clínica' tab, active by default.
      await expect(page.getByRole('button', { name: /perfil de clínica/i })).toBeVisible()
    })

    test('should have language selector', async ({ authedPage: page }) => {
      await page.goto('/settings')

      // The language selector only renders on the Preferences tab, not the
      // default Profile tab this test lands on.
      await page.getByRole('button', { name: /preferencias/i }).click()

      await expect(page.getByLabel(/idioma/i)).toBeVisible()
    })

    test('should display clinic information fields', async ({ authedPage: page }) => {
      await page.goto('/settings')

      // Should have input fields for clinic info
      await expect(page.getByText(/nombre de la clínica/i)).toBeVisible()
    })
  })

  test.describe('Language Switching', () => {
    test('changes the interface language from the Preferences dropdown', async ({
      authedPage: page,
    }) => {
      await page.goto('/settings')

      // Like the selector test above, the control only exists on the
      // Preferences tab; the default Profile tab has no language field.
      await page.getByRole('button', { name: /preferencias/i }).click()

      // Located by id, not by label text or role: the label itself is
      // translated, so a text locator would stop matching the moment this
      // test does its job. `getByRole('combobox').first()` is worse still —
      // this tab renders several selects (date format, time format, ...) and
      // .first() is a coin toss between them.
      const languageSelect = page.locator('#language')
      await expect(languageSelect).toBeVisible()

      // Assert an observable consequence, not just the select's own value:
      // the heading is rendered through i18n, so it only changes if
      // changeLanguage actually ran (PreferencesForm's handleChange).
      await languageSelect.selectOption('en')
      await expect(languageSelect).toHaveValue('en')
      await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()

      // Switch back, so the test proves a real transition in both directions
      // rather than depending on which language the fixture happens to seed.
      await languageSelect.selectOption('es')
      await expect(languageSelect).toHaveValue('es')
      await expect(page.getByRole('heading', { name: /configuración/i })).toBeVisible()
    })

    // Removed here: 'should be able to change language from buttons'. It drove
    // LanguageSelector's `variant="buttons"` UI, which is not rendered on
    // /settings — its only non-test call site is RegisterPage. The locator
    // `getByRole('button', { name: /EN/i })` therefore resolved to the
    // "Prefer[en]cias" tab, and the assertion compared a tab's active classes
    // against a language button's. That variant is covered directly by
    // LanguageSelector.test.tsx, and the /settings language path by the test
    // above and by PreferencesForm.test.tsx.
  })

  test.describe('Clinic Information Update', () => {
    test('should have save button for clinic settings', async ({ authedPage: page }) => {
      await page.goto('/settings')

      await expect(page.getByRole('button', { name: /guardar/i })).toBeVisible()
    })

    test('should allow editing clinic name', async ({ authedPage: page }) => {
      await page.goto('/settings')

      // Anchored to the field's own label rather than `getByRole('textbox')
      // .first()`, which asserted nothing about WHICH of the profile form's
      // several text inputs it was editing.
      const nameInput = page.getByLabel(/nombre de la clínica/i)
      await expect(nameInput).toBeVisible()

      await nameInput.fill('Test Clinic Name')

      await expect(nameInput).toHaveValue('Test Clinic Name')
    })
  })

  test.describe('Navigation', () => {
    test('should have navigation menu visible', async ({ authedPage: page }) => {
      await page.goto('/settings')

      // Should have links to other pages
      await expect(page.getByRole('link', { name: /pacientes/i })).toBeVisible()
      await expect(page.getByRole('link', { name: /citas/i })).toBeVisible()
    })

    test('should navigate to patients page from menu', async ({ authedPage: page }) => {
      await page.goto('/settings')

      await page.getByRole('link', { name: /pacientes/i }).click()

      await expect(page).toHaveURL(/\/patients/)
    })

    test('should navigate to appointments page from menu', async ({ authedPage: page }) => {
      await page.goto('/settings')

      await page.getByRole('link', { name: /citas/i }).click()

      await expect(page).toHaveURL(/\/appointments/)
    })
  })

  // Removed here: the 'User Profile' block's 'should display user profile
  // section'. It visited /settings, where the only "perfil" text is the
  // "Perfil de Clínica" tab — a CLINIC profile; user profiles live on
  // /users. Its assertion was `expect(typeof hasUserSection).toBe('boolean')`,
  // which is true whether or not anything was found, so the test could not
  // fail and never covered the section it was named after.
})
