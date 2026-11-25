import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Page, Request } from '@playwright/test'
import { test, expect } from './fixtures/authed'
import { AUTH_STATE_PATH } from './global-setup'

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(__dirname, '../../../.task-log/screenshots')

/**
 * An appointment cost must not be cleared by a figure the browser cannot
 * parse (task #713, G6).
 *
 * The mechanism: a <input type="number"> reports value === '' whenever its
 * text is not a valid floating-point number (HTML value sanitization) while
 * the typed text stays on screen and validity.badInput is true. The form is
 * noValidate and its schema accepts '', so text the browser cannot parse at
 * all reaches the server as a clear while the operator still sees her own text
 * on screen: visible text, value === '', validity.badInput === true, and
 * PUT {"cost": null}. That is the confirmed half, and it is what this spec
 * measures.
 *
 * What is NOT established is any particular figure that produced it. An es-UY
 * "1.500,00" does not: measured by keystroke on 2026-11-25 it leaves DOM value
 * "1.50000" with badInput false and parseFloat sends 1.5 ("4.500,00" sends
 * 4.5) — the figure is silently reinterpreted, not cleared. Production
 * measured the appointment's `cost` column empty, not 1.5, so "1.500,00"
 * cannot be what happened on 2026-11-19, and the input that produced the empty
 * row is still unidentified. The 1.5 reinterpretation defect carries its own
 * measurement on issue #726.
 *
 * jsdom implements neither sanitization nor badInput, so this is the only
 * layer that measures the real browser step.
 *
 * The measured values are printed BEFORE the assertions so that a run against
 * an unfixed form still reports what the browser did.
 *
 * Assertions go on `cost` and on the absence of the clearing request, never on
 * `updatedAt` (@updatedAt, moved by recalculatePaidStatus on untouched rows).
 * The appointment is created through the API and opened by identity through
 * its own patient (a fresh, run-unique last name): no `.first()` on a list.
 */

async function api(method: string, route: string, body?: unknown) {
  const { accessToken } = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'))
  const res = await fetch(`${API_BASE_URL}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${await res.text()}`)
  const json = await res.json()
  return json.data ?? json
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Tabs' })

/** The cost input: its <label> is a sibling, not a wrapper, so no getByLabel. */
const costField = (dialog: ReturnType<Page['getByRole']>) =>
  dialog.locator('label', { hasText: /^Costo \(\$\)$/ }).locator('xpath=following-sibling::input[1]')

async function openCitas(page: Page) {
  await tabs(page).getByRole('button', { name: 'Citas' }).click()
  const allPeriod = page.getByRole('button', { name: 'Todas', exact: true })
  if (!(await allPeriod.isVisible().catch(() => false))) {
    await page.getByRole('heading', { name: 'Citas', level: 2 }).click()
  }
  await expect(allPeriod).toBeVisible()
  await allPeriod.click()
  await expect(allPeriod).toHaveClass(/bg-blue-600/)
}

const debtText = async (page: Page) => {
  const header = page.getByTestId('patient-balance')
  await expect(header).toBeVisible()
  await expect(header).not.toContainText('—')
  return (await header.innerText()).replace(/\n/g, ' | ')
}

/**
 * The text typed over the stored figure. A lone minus sign, because the sign
 * and the exponent are part of the floating-point grammar in every locale:
 * Chromium accepts the keystroke and is left holding an incomplete number. A
 * "," is a decimal separator whose acceptance depends on the locale the
 * browser build resolved, which is why it is not portable.
 *
 * Measured on 2026-11-25 on <input type="number" step="0.01" min="0"> driven
 * by pressSequentially — the same input shape as the cost field, min="0"
 * included, so a lone "-" is badInput and not a range error: typing "-" leaves
 * DOM value "" with validity.badInput === true; "e" likewise; "," likewise but
 * on macOS Chromium only, which is the one that does not survive CI.
 *
 * The limit of that evidence: all three pass on macOS, so a local run cannot
 * tell "-" apart from ","; the only environment that discriminates is the Linux
 * CI runner. "-" is therefore a prediction with a break point — if CI again
 * reports MEASURED_DISPLAYED_TEXT: "" for "-", the hypothesis is refuted.
 */
const UNPARSEABLE = '-'

test.describe('Appointment cost is not cleared by an unparseable figure (#713)', () => {
  test('an unparseable figure over a stored 1500 is refused, not saved as a clear', async ({
    authedPage: page,
  }) => {
    const tag = `${Date.now()}`
    const lastName = `CostoBorrado${tag}`

    // Reuse an existing doctor: the e2e tenant's plan caps doctors at 10 and
    // nothing in the suite releases one, so creating a doctor here would starve
    // the specs that run after this one (PLAN_LIMIT_EXCEEDED, 403).
    const doctors = (await api('GET', '/doctors')) as Array<{ id: string }> | { doctors: Array<{ id: string }> }
    const doctorList = Array.isArray(doctors) ? doctors : doctors.doctors
    // Create one only on a tenant that has none at all (it then stays under the cap).
    const doctor =
      doctorList[0] ??
      (await api('POST', '/doctors', {
        firstName: 'E2E',
        lastName: `Doc${tag}`,
        workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      }))
    const patient = await api('POST', '/patients', { firstName: 'E2E', lastName })
    // The doctor is shared, so the slot must be one no other spec or earlier run
    // used: a past day picked from the run's own timestamp (about 4,000 days of
    // range), never today's 11:00.
    const start = new Date()
    start.setDate(start.getDate() - 30 - (Number(tag) % 4000))
    start.setHours(11, 0, 0, 0)
    const appointment = await api('POST', '/appointments', {
      patientId: patient.id,
      doctorId: doctor.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
      cost: 1500,
    })
    // A completed visit with a cost is a charge, so the patient owes it.
    await api('PUT', `/appointments/${appointment.id}/mark-done`, {})

    const storedCost = async () => {
      const rows = (await api('GET', `/appointments/by-patient/${patient.id}`)) as Array<{
        id: string
        cost: string | number | null
      }>
      const mine = rows.filter((r) => r.id === appointment.id)
      expect(mine).toHaveLength(1)
      return mine[0].cost === null ? null : Number(mine[0].cost)
    }
    expect(await storedCost()).toBe(1500)

    // ---------------------------------------------------------------- the walk
    await page.goto(`/patients/${patient.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
    const debtBefore = await debtText(page)
    console.log(`DEBT_BEFORE: ${debtBefore}`)
    expect(debtBefore).toMatch(/1,500\.00/)

    await openCitas(page)
    await page.getByRole('button', { name: 'Opciones' }).click()
    await page.getByRole('button', { name: /^Editar$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const cost = costField(dialog)
    await expect(cost).toHaveCount(1)
    await expect(cost).toHaveValue('1500')
    await page.screenshot({ path: `${SHOTS}/713-01-edit-form-holds-1500.png`, fullPage: true })

    // Select-all and TYPE (fill() would reject a malformed value outright).
    await cost.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(UNPARSEABLE)

    // What the browser actually did with the text.
    const measured = await cost.evaluate((el) => {
      const input = el as HTMLInputElement
      return {
        domValue: input.value,
        badInput: input.validity.badInput,
        type: input.type,
      }
    })
    // The text on screen: the rendered value of the box, read via the
    // selection of the whole field's text through the clipboard-free route —
    // innerText of a number input is empty, so read what Chromium displays by
    // selecting it and asking the page for the selection string.
    const displayed = await cost.evaluate((el) => {
      const input = el as HTMLInputElement
      input.select()
      return window.getSelection()?.toString() || document.getSelection()?.toString() || ''
    })
    console.log(`MEASURED_DISPLAYED_TEXT: ${JSON.stringify(displayed)}`)
    console.log(`MEASURED_DOM_VALUE: ${JSON.stringify(measured.domValue)}`)
    console.log(`MEASURED_BAD_INPUT: ${measured.badInput}`)
    await page.screenshot({ path: `${SHOTS}/713-02-typed-unparseable.png`, fullPage: true })

    // The browser step the whole task rests on. The typed text must really be
    // on screen: if the browser rejects the keystroke the box is empty and
    // badInput is false, which is a different (benign) state this guard must
    // not be judged on.
    expect(displayed).toBe(UNPARSEABLE)
    expect(measured.type).toBe('number')
    expect(measured.domValue).toBe('')
    expect(measured.badInput).toBe(true)

    // ---------------------------------------------------------------- save
    const puts: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith(`/api/appointments/${appointment.id}`)) {
        puts.push(r)
      }
    })
    const save = dialog.getByRole('button', { name: /guardar cambios/i })
    // Vacuity: the Save button the spec presses exists, is enabled, and is
    // inside the dialog of THIS appointment (its cost box is the one we typed in).
    await expect(save).toHaveCount(1)
    await expect(save).toBeEnabled()
    await save.click()
    // Give a (wrongly) issued request time to leave the page before reading.
    await page.waitForTimeout(1500)

    const payloads = puts.map((r) => r.postDataJSON())
    console.log(`OBSERVED_PUT_COUNT: ${puts.length}`)
    console.log(`OBSERVED_PUT_PAYLOAD: ${JSON.stringify(payloads)}`)
    console.log(`STORED_COST_AFTER: ${await storedCost()}`)
    await page.screenshot({ path: `${SHOTS}/713-03-after-save-attempt.png`, fullPage: true })
    if (puts.length > 0) {
      // Only reached on an unfixed form: report the consequence before failing.
      await page.goto(`/patients/${patient.id}`)
      console.log(`DEBT_AFTER_REQUEST: ${await debtText(page)}`)
    }

    // The submit is refused: no clearing request, the error is shown, the form
    // stays open and the stored cost is untouched.
    expect(payloads.filter((p) => p && p.cost === null)).toHaveLength(0)
    expect(puts).toHaveLength(0)
    await expect(dialog.getByText(/El monto no es un número válido/)).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(await storedCost()).toBe(1500)

    // And the debt did not move.
    await dialog.getByRole('button', { name: /cancelar/i }).click()
    await expect(dialog).not.toBeVisible()
    await page.goto(`/patients/${patient.id}`)
    const debtAfter = await debtText(page)
    console.log(`DEBT_AFTER: ${debtAfter}`)
    expect(debtAfter).toBe(debtBefore)
  })

  /**
   * G7: the recovery route. A number input that leaves badInput by deleting its
   * unparseable text emits NO React change event (value tracking sees '' before
   * and after), so a guard that caches badInput from onChange latches: the error
   * stays over an empty box, Save is refused, and the deliberate clear is never
   * armed. Only a real browser sanitizes the value, so only this layer holds it.
   */
  test('deleting the unparseable text to an empty box releases the guard and saves the deliberate clear', async ({
    authedPage: page,
  }) => {
    const tag = `${Date.now()}`
    const lastName = `CostoRecupera${tag}`

    // Reuse an existing doctor (plan cap of 10, nothing releases one).
    const doctors = (await api('GET', '/doctors')) as Array<{ id: string }> | { doctors: Array<{ id: string }> }
    const doctorList = Array.isArray(doctors) ? doctors : doctors.doctors
    const doctor =
      doctorList[0] ??
      (await api('POST', '/doctors', {
        firstName: 'E2E',
        lastName: `Doc${tag}`,
        workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      }))
    const patient = await api('POST', '/patients', { firstName: 'E2E', lastName })
    const start = new Date()
    start.setDate(start.getDate() - 30 - (Number(tag) % 4000))
    start.setHours(11, 0, 0, 0)
    const appointment = await api('POST', '/appointments', {
      patientId: patient.id,
      doctorId: doctor.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
      cost: 1500,
    })
    await api('PUT', `/appointments/${appointment.id}/mark-done`, {})

    const storedCost = async () => {
      const rows = (await api('GET', `/appointments/by-patient/${patient.id}`)) as Array<{
        id: string
        cost: string | number | null
      }>
      const mine = rows.filter((r) => r.id === appointment.id)
      expect(mine).toHaveLength(1)
      return mine[0].cost === null ? null : Number(mine[0].cost)
    }
    expect(await storedCost()).toBe(1500)

    await page.goto(`/patients/${patient.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(lastName), level: 1 })).toBeVisible()
    const debtBefore = await debtText(page)
    console.log(`G7_DEBT_BEFORE: ${debtBefore}`)
    expect(debtBefore).toMatch(/1,500\.00/)

    await openCitas(page)
    await page.getByRole('button', { name: 'Opciones' }).click()
    await page.getByRole('button', { name: /^Editar$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const cost = costField(dialog)
    await expect(cost).toHaveCount(1)
    await expect(cost).toHaveValue('1500')
    const costError = dialog.getByText(/El monto no es un número válido/)

    // 1. Type the unparseable text over the stored figure: the guard arms.
    await cost.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(UNPARSEABLE)
    const armed = await cost.evaluate((el) => ({
      value: (el as HTMLInputElement).value,
      badInput: (el as HTMLInputElement).validity.badInput,
    }))
    expect(armed).toEqual({ value: '', badInput: true })
    await expect(costError).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/713-04-g7-armed.png`, fullPage: true })

    // 2. Backspace once: the box is now genuinely empty.
    await page.keyboard.press('Backspace')
    const emptied = await cost.evaluate((el) => ({
      value: (el as HTMLInputElement).value,
      badInput: (el as HTMLInputElement).validity.badInput,
    }))
    console.log(`G7_AFTER_BACKSPACE: ${JSON.stringify(emptied)}`)
    expect(emptied).toEqual({ value: '', badInput: false })

    // 3. The error is gone and the field is empty.
    await expect(costError).toHaveCount(0)
    await expect(cost).toHaveValue('')
    await page.screenshot({ path: `${SHOTS}/713-05-g7-emptied.png`, fullPage: true })

    // 4. Save succeeds: exactly one PUT to THIS appointment, carrying cost null.
    const puts: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith(`/api/appointments/${appointment.id}`)) {
        puts.push(r)
      }
    })
    const save = dialog.getByRole('button', { name: /guardar cambios/i })
    // Vacuity: Save is present and enabled before the click.
    await expect(save).toHaveCount(1)
    await expect(save).toBeEnabled()
    await save.click()
    await expect(dialog).not.toBeVisible()

    const payloads = puts.map((r) => r.postDataJSON())
    console.log(`G7_PUT_PAYLOADS: ${JSON.stringify(payloads)}`)
    expect(puts).toHaveLength(1)
    expect(payloads[0].cost).toBeNull()
    expect('cost' in payloads[0]).toBe(true)

    // 5. Stored cost is null and the debt dropped by 1,500.
    expect(await storedCost()).toBeNull()
    await page.goto(`/patients/${patient.id}`)
    const debtAfter = await debtText(page)
    console.log(`G7_DEBT_AFTER: ${debtAfter}`)
    expect(debtAfter).not.toBe(debtBefore)
    expect(debtAfter).not.toMatch(/1,500\.00/)
    await page.screenshot({ path: `${SHOTS}/713-06-g7-debt-dropped.png`, fullPage: true })
  })
})
