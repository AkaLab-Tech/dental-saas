import { test, expect } from './fixtures/authed'

// Guards #508: the sidebar footer used to be absolutely positioned, so it
// reserved no space and the last nav link ("Configuración") was painted
// underneath the signed-in user block. jsdom computes no layout, so only a
// real browser can prove the two boxes no longer overlap.
test.describe('Sidebar footer layout (#508)', () => {
  test('Configuración link sits above the user block and is clickable at 1369x677', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize({ width: 1369, height: 677 })
    await page.goto('/')

    const sidebar = page.locator('aside')
    const link = sidebar.locator('a[href="/settings"]')
    const footer = sidebar.getByRole('button', { name: /cerrar sesión/i }).locator('xpath=..')

    await expect(link).toBeVisible()
    await expect(footer).toBeVisible()

    // At this height the nav list scrolls internally (flex-1 overflow-y-auto),
    // so bring the last entry into view the way a user would before measuring.
    await link.scrollIntoViewIfNeeded()

    const linkBox = await link.boundingBox()
    const footerBox = await footer.boundingBox()
    expect(linkBox).not.toBeNull()
    expect(footerBox).not.toBeNull()

    const linkBottom = linkBox!.y + linkBox!.height
    expect(
      linkBottom,
      `link bottom ${linkBottom}px vs footer top ${footerBox!.y}px`,
    ).toBeLessThanOrEqual(footerBox!.y)

    // Hit-testable: nothing obscures the link.
    await page.getByRole('link', { name: /configuración/i }).click({ trial: true })
  })

  test('footer stays inside a short viewport', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1369, height: 500 })
    await page.goto('/')

    const footer = page
      .locator('aside')
      .getByRole('button', { name: /cerrar sesión/i })
      .locator('xpath=..')
    await expect(footer).toBeVisible()
    const box = await footer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(500)
  })
})
