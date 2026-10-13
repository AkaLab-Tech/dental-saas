import { readFileSync } from 'fs'
import type { Download, Page } from '@playwright/test'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

/**
 * One PDF for the whole treatment plan (task #541).
 *
 * The unit suite covers the wiring exhaustively. What only a real browser can
 * see, and what this spec exists for:
 *
 *   1. The split control actually renders as a split control, and the chevron's
 *      hit area is genuinely clickable (it carries only px-2 of padding - this
 *      project has form here: #508's only catch was a 53px overlap that no
 *      layer but e2e saw).
 *   2. ONE click on the primary button produces exactly ONE download. That is
 *      the done criterion: "one action -> one PDF the patient can be handed".
 *      The clinic's real shape is nine budgets of one item each, so the failure
 *      mode worth proving absent is nine files.
 *   3. The menu's individual-budget entries still work as the secondary path.
 *
 * Seeding goes through the API (nine budgets through the UI would be slow and
 * brittle); every assertion is made against the rendered page.
 */

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

/** Nine budgets of one item each, 2.500 apiece -> 22.500, mirroring the real record. */
const BUDGET_COUNT = 9
const UNIT_PRICE = 2500

let patientId = ''
let accessToken = ''

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status}): ${await res.text()}`)
  }
  const json = await res.json()
  return json.data ?? json
}

test.beforeAll(async () => {
  accessToken = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8')).accessToken

  // Synthetic fixture identity only - never a real patient's name.
  const patient = await apiPost('/patients', {
    firstName: 'E2E',
    lastName: `Plan${Date.now()}`,
  })
  patientId = patient.id
  expect(patientId, 'seeded patient id').toBeTruthy()

  for (let i = 0; i < BUDGET_COUNT; i++) {
    await apiPost(`/patients/${patientId}/budgets`, {
      status: 'APPROVED',
      items: [
        {
          description: `Tratamiento ${i + 1}`,
          quantity: 1,
          unitPrice: UNIT_PRICE,
        },
      ],
    })
  }
})

/**
 * The control lives in the record header but reads the budgets store, which is
 * only populated once BudgetsSection mounts - i.e. after the Presupuestos tab
 * is opened. (Pre-existing behaviour, unchanged by #541.)
 */
async function openRecordWithBudgetsLoaded(page: Page) {
  await page.goto(`/patients/${patientId}`)
  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('button', { name: 'Presupuestos' })
    .click()

  const primary = page.getByRole('button', { name: 'Exportar plan de tratamiento' })
  await expect(primary).toBeVisible()
  return primary
}

function chevronOf(page: Page) {
  return page.getByRole('button', { name: 'Elige qué presupuesto exportar' })
}

test.describe('Patient treatment-plan PDF (#541)', () => {
  test('the split control renders at rest: one primary action plus a chevron', async ({
    authedPage: page,
  }) => {
    const primary = await openRecordWithBudgetsLoaded(page)
    const chevron = chevronOf(page)

    await expect(primary).toBeVisible()
    await expect(chevron).toBeVisible()
    await expect(chevron).toHaveAttribute('aria-haspopup', 'menu')
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')

    // The menu is shut until asked for.
    await expect(page.getByRole('menu')).toHaveCount(0)

    await page.screenshot({
      path: '.task-log/screenshots/541-split-button-at-rest.png',
    })
  })

  test("the chevron's hit area is genuinely clickable and does not overlap the primary", async ({
    authedPage: page,
  }) => {
    const primary = await openRecordWithBudgetsLoaded(page)
    const chevron = chevronOf(page)

    const primaryBox = (await primary.boundingBox())!
    const chevronBox = (await chevron.boundingBox())!
    expect(primaryBox, 'primary bounding box').toBeTruthy()
    expect(chevronBox, 'chevron bounding box').toBeTruthy()

    console.log(
      `CHEVRON_BOX: x=${chevronBox.x.toFixed(1)} y=${chevronBox.y.toFixed(1)} ` +
        `w=${chevronBox.width.toFixed(1)} h=${chevronBox.height.toFixed(1)}`
    )
    console.log(
      `PRIMARY_BOX: x=${primaryBox.x.toFixed(1)} y=${primaryBox.y.toFixed(1)} ` +
        `w=${primaryBox.width.toFixed(1)} h=${primaryBox.height.toFixed(1)}`
    )

    // A hit area small enough to miss is the defect we are hunting.
    expect(chevronBox.width, 'chevron hit-area width').toBeGreaterThanOrEqual(24)
    expect(chevronBox.height, 'chevron hit-area height').toBeGreaterThanOrEqual(32)

    // #508's lesson: the two halves must not overlap. Allow 1px of rounding.
    expect(
      chevronBox.x + 1,
      'chevron must start at or after the primary button ends (no overlap)'
    ).toBeGreaterThanOrEqual(primaryBox.x + primaryBox.width)

    // Nothing is painted on top of the chevron's centre: the element under that
    // point must be the chevron itself or one of its descendants.
    const cx = chevronBox.x + chevronBox.width / 2
    const cy = chevronBox.y + chevronBox.height / 2
    const ownsItsCentre = await page.evaluate(
      ({ x, y, label }) => {
        const el = document.elementFromPoint(x, y)
        if (!el) return false
        const btn = el.closest('button')
        return !!btn && btn.getAttribute('aria-label') === label
      },
      { x: cx, y: cy, label: 'Elige qué presupuesto exportar' }
    )
    expect(ownsItsCentre, 'chevron owns the pixel at its own centre').toBe(true)

    // Now prove it with a real mouse click at that exact point.
    await page.mouse.click(cx, cy)

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.getByText('Presupuestos individuales')).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveCount(BUDGET_COUNT)

    await page.screenshot({
      path: '.task-log/screenshots/541-menu-open.png',
    })
  })

  test('one click on the primary button yields exactly ONE PDF download', async ({
    authedPage: page,
  }) => {
    const primary = await openRecordWithBudgetsLoaded(page)

    const downloads: Download[] = []
    page.on('download', (d) => downloads.push(d))

    const firstDownload = page.waitForEvent('download', { timeout: 60_000 })
    await primary.click()
    const download = await firstDownload

    // Absence of further downloads cannot be asserted web-first; give the app a
    // generous settle window on this loaded host before counting.
    await page.waitForTimeout(5_000)

    console.log(`DOWNLOAD_COUNT: ${downloads.length}`)
    console.log(`DOWNLOAD_FILENAME: ${download.suggestedFilename()}`)
    expect(downloads.length, 'one action must produce exactly one file').toBe(1)

    const filePath = await download.path()
    expect(filePath, 'download saved to disk').toBeTruthy()
    const head = readFileSync(filePath!).subarray(0, 5).toString('latin1')
    console.log(`DOWNLOAD_MAGIC: ${JSON.stringify(head)}`)
    expect(head.startsWith('%PDF'), 'downloaded file is a real PDF').toBe(true)
    expect(download.suggestedFilename()).toMatch(/^treatment-plan-.*\.pdf$/)

    await page.screenshot({
      path: '.task-log/screenshots/541-after-primary-download.png',
    })
  })

  test('a menu entry still downloads one individual budget PDF', async ({ authedPage: page }) => {
    await openRecordWithBudgetsLoaded(page)
    await chevronOf(page).click()

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    const downloads: Download[] = []
    page.on('download', (d) => downloads.push(d))

    const firstDownload = page.waitForEvent('download', { timeout: 60_000 })
    await menu.getByRole('menuitem').first().click()
    const download = await firstDownload
    await page.waitForTimeout(5_000)

    console.log(`MENU_DOWNLOAD_COUNT: ${downloads.length}`)
    console.log(`MENU_DOWNLOAD_FILENAME: ${download.suggestedFilename()}`)
    expect(downloads.length, 'one menu entry must produce exactly one file').toBe(1)

    const filePath = await download.path()
    const head = readFileSync(filePath!).subarray(0, 5).toString('latin1')
    expect(head.startsWith('%PDF'), 'individual budget file is a real PDF').toBe(true)

    // The menu closes on selection.
    await expect(menu).toHaveCount(0)

    await page.screenshot({
      path: '.task-log/screenshots/541-menu-individual-download.png',
    })
  })

  test('the LAST of nine menu entries is still reachable and downloads one PDF', async ({
    authedPage: page,
  }) => {
    await openRecordWithBudgetsLoaded(page)
    await chevronOf(page).click()

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    // With the clinic's real shape (nine budgets) the menu is taller than the
    // fold and carries no internal scroll, so the worst-case entry is the one
    // worth proving clickable.
    const menuBox = (await menu.boundingBox())!
    const viewport = page.viewportSize()!
    console.log(
      `MENU_BOX: y=${menuBox.y.toFixed(1)} h=${menuBox.height.toFixed(1)} ` +
        `bottom=${(menuBox.y + menuBox.height).toFixed(1)} viewportH=${viewport.height}`
    )
    console.log(
      `MENU_OVERFLOWS_FOLD: ${menuBox.y + menuBox.height > viewport.height}`
    )

    const last = menu.getByRole('menuitem').last()
    const downloads: Download[] = []
    page.on('download', (d) => downloads.push(d))

    const firstDownload = page.waitForEvent('download', { timeout: 60_000 })
    await last.click()
    const download = await firstDownload
    await page.waitForTimeout(5_000)

    console.log(`LAST_MENU_DOWNLOAD_COUNT: ${downloads.length}`)
    expect(downloads.length, 'the last entry must produce exactly one file').toBe(1)
    const filePath = await download.path()
    const head = readFileSync(filePath!).subarray(0, 5).toString('latin1')
    expect(head.startsWith('%PDF')).toBe(true)
  })

  test('the patient record as a whole still renders, header balance included', async ({
    authedPage: page,
  }) => {
    await openRecordWithBudgetsLoaded(page)

    // #538 shipped debt/credit in this header - it must not have regressed.
    const balance = page.getByTestId('patient-balance')
    await expect(balance).toBeVisible()
    await expect(balance).not.toContainText('—')

    await page.screenshot({
      path: '.task-log/screenshots/541-patient-record-full.png',
      fullPage: true,
    })
  })
})
