import { test, expect } from './fixtures/authed'

/**
 * Covers task #313 — overdue labwork indicator & filter:
 *  - a `destructive` "Atrasado" badge on cards for active, undelivered,
 *    past-due labworks (see isLabworkOverdue in src/lib/labwork-api.ts)
 *  - the "Atrasado" delivery-status filter button (t('labworks.status.overdue'))
 *  - the 5th overdue-count stat card
 *
 * A freshly-registered e2e tenant (see global-setup.ts) has no seeded
 * patients or labworks, so this spec creates a patient first (the
 * labwork form requires one), then a labwork with a past `date` left
 * undelivered, which is sufficient to trigger the overdue badge per
 * isLabworkOverdue's definition.
 */
test.describe('Labworks — overdue indicator & filter', () => {
  test('shows overdue stat card, badge and filter for a past-due labwork', async ({ authedPage: page }) => {
    // Seed a patient — the labwork form requires one to be selected.
    await page.goto('/patients')
    await page.getByRole('button', { name: /nuevo paciente/i }).click()
    const patientDialog = page.getByRole('dialog')
    await expect(patientDialog).toBeVisible()
    await patientDialog.getByPlaceholder('Juan').fill('Overdue')
    await patientDialog.getByPlaceholder('Pérez').fill('E2E')
    await patientDialog.getByRole('button', { name: /crear paciente/i }).click()
    await expect(patientDialog).not.toBeVisible()

    // Now create a labwork dated well in the past, left undelivered, so
    // it renders as overdue.
    await page.goto('/labworks')
    await expect(page.getByRole('heading', { name: 'Trabajos de Laboratorio', exact: true })).toBeVisible()

    await page.getByRole('button', { name: /nuevo trabajo/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByPlaceholder('Buscar paciente por nombre...').fill('Overdue')
    await dialog.getByText('Overdue E2E', { exact: true }).click()

    await dialog.locator('#lab').fill('Lab Atrasado E2E')
    await dialog.locator('#date').fill('2020-01-15')

    await dialog.getByRole('button', { name: /crear trabajo/i }).click()
    await expect(dialog).not.toBeVisible()

    // Overdue badge on the card (scoped to the card container so it
    // doesn't collide with the stat card / filter button, which use the
    // same "Atrasado" label).
    const card = page.getByText('Lab Atrasado E2E').locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]')
    await expect(card.getByText('Atrasado', { exact: true })).toBeVisible()
    // test-results/ is already gitignored — screenshots must never land in
    // a tracked path.
    await page.screenshot({ path: 'test-results/screenshots/labworks-overdue-badge.png', fullPage: true })

    // 5th stat card — overdue count. The stats grid renders 5 cards in
    // order: Total, Por Pagar, Por Entregar, Valor Total, Atrasado.
    const statsCards = page.locator('.grid.grid-cols-2.md\\:grid-cols-5 > div')
    const overdueStat = statsCards.nth(4)
    await expect(overdueStat).toContainText('Atrasado')
    await expect(overdueStat).toContainText('1')

    // Delivery-status filter group: open filters, use the "Atrasado" toggle.
    await page.getByRole('button', { name: /^filtros$/i }).click()
    const overdueFilterButton = page.getByRole('button', { name: 'Atrasado', exact: true })
    await expect(overdueFilterButton).toBeVisible()
    await page.screenshot({ path: 'test-results/screenshots/labworks-filters-and-stats.png', fullPage: true })

    await overdueFilterButton.click()
    await expect(page.getByText('Lab Atrasado E2E')).toBeVisible()
    await page.screenshot({ path: 'test-results/screenshots/labworks-overdue-filter-active.png', fullPage: true })

    // Mutually exclusive with the "delivered" filter: selecting overdue
    // must not leave "Entregados" active.
    const deliveredButton = page.getByRole('button', { name: 'Entregados', exact: true })
    await expect(deliveredButton).not.toHaveClass(/bg-green-50/)
  })
})
