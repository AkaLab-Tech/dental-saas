import { test, expect } from '@playwright/test'

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')
  })

  test.describe('Login', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login')

      await expect(page.getByRole('heading', { name: /iniciar sesión/i })).toBeVisible()
      await expect(page.getByPlaceholder(/email/i)).toBeVisible()
      // Password placeholder is masked dots ("••••••••"), not readable text — use the label.
      await expect(page.getByLabel(/^contraseña$/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /iniciar sesión/i })).toBeVisible()
    })

    test('should show validation errors for empty fields', async ({ page }) => {
      await page.goto('/login')

      const loginButton = page.getByRole('button', { name: /iniciar sesión/i })
      await loginButton.click()

      // Login schema only has an .email() check (no .min(1)), so an empty
      // email renders "Email inválido", not a "requerido" message.
      await expect(page.getByText(/email inválido/i)).toBeVisible()
      await expect(page.getByText(/contraseña es requerida/i)).toBeVisible()
    })

    test('should show error for invalid email format', async ({ page }) => {
      await page.goto('/login')

      // The <input type="email"> intercepts obviously-malformed values (e.g.
      // "invalid-email", missing "@") via native HTML5 constraint validation
      // before the form's submit handler ever runs, so zod never gets a
      // chance to render its own message. "test@localhost" passes native
      // validation but fails zod's stricter .email() check, so it reaches
      // the app's validation error as intended.
      await page.getByPlaceholder(/email/i).fill('test@localhost')
      await page.getByLabel(/^contraseña$/i).fill('password123')
      await page.getByRole('button', { name: /iniciar sesión/i }).click()

      await expect(page.getByText(/email inválido/i)).toBeVisible()
    })

    test('should navigate to forgot password page', async ({ page }) => {
      await page.goto('/login')

      await page.getByRole('link', { name: /olvidaste tu contraseña/i }).click()

      await expect(page).toHaveURL(/\/forgot-password/)
      await expect(page.getByRole('heading', { name: /recuperar contraseña/i })).toBeVisible()
    })

    test('should navigate to register page', async ({ page }) => {
      await page.goto('/login')

      await page.getByRole('link', { name: /regístrate aquí/i }).click()

      await expect(page).toHaveURL(/\/register/)
      await expect(page.getByRole('heading', { name: /crear cuenta/i })).toBeVisible()
    })
  })

  test.describe('Register', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/register')

      await expect(page.getByRole('heading', { name: /crear cuenta/i })).toBeVisible()
      // These fields use <label> text, not placeholders — assert by label.
      await expect(page.getByLabel(/nombre de la clínica/i)).toBeVisible()
      await expect(page.getByLabel(/identificador de clínica/i)).toBeVisible()
      await expect(page.getByLabel(/^nombre$/i)).toBeVisible()
      await expect(page.getByLabel(/^apellido$/i)).toBeVisible()
      await expect(page.getByPlaceholder(/email/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /crear cuenta/i })).toBeVisible()
    })

    test('should show validation errors for empty required fields', async ({ page }) => {
      await page.goto('/register')

      await page.getByRole('button', { name: /crear cuenta/i }).click()

      // clinicName is .optional() in the current schema, so no "requerido"
      // error fires for it — only the slug's min-length message does.
      await expect(page.getByText(/identificador debe tener al menos 3 caracteres/i)).toBeVisible()
    })

    test('should navigate to login page', async ({ page }) => {
      await page.goto('/register')

      await page.getByRole('link', { name: /inicia sesión/i }).click()

      await expect(page).toHaveURL(/\/login/)
    })
  })

  test.describe('Forgot Password', () => {
    test('should display forgot password form', async ({ page }) => {
      await page.goto('/forgot-password')

      await expect(page.getByRole('heading', { name: /recuperar contraseña/i })).toBeVisible()
      await expect(page.getByPlaceholder(/email/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /enviar enlace/i })).toBeVisible()
    })

    test('should show validation error for empty email', async ({ page }) => {
      await page.goto('/forgot-password')

      await page.getByRole('button', { name: /enviar enlace/i }).click()

      // Same as login: the .email() check renders "Email inválido" for an
      // empty field, not a "requerido" message.
      await expect(page.getByText(/email inválido/i)).toBeVisible()
    })

    test('should navigate back to login', async ({ page }) => {
      await page.goto('/forgot-password')

      await page.getByRole('link', { name: /volver al inicio de sesión/i }).click()

      await expect(page).toHaveURL(/\/login/)
    })
  })

  test.describe('Navigation', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
      await page.goto('/patients')

      await expect(page).toHaveURL(/\/login/)
    })

    test('should redirect to dashboard when accessing root while authenticated', async ({ page }) => {
      // This test would need a valid session
      // For now, just test the redirect logic exists
      await page.goto('/')

      // Should either show homepage or redirect to login
      const hasHomeContent = await page.getByText(/sistema de gestión/i).isVisible().catch(() => false)
      const hasLoginForm = await page.getByRole('heading', { name: /iniciar sesión/i }).isVisible().catch(() => false)

      expect(hasHomeContent || hasLoginForm).toBeTruthy()
    })
  })
})
