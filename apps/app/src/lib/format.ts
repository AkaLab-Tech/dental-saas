/**
 * Format a number as currency: ISO code + amount, e.g. "UYU 2,300.00".
 *
 * Uses currencyDisplay:'code' so amounts stay unambiguous across clinics that
 * share the same narrow symbol (ARS, UYU and USD all render as "$"). The
 * previous output coupled a bare symbol with the code in parentheses
 * ("$(UYU) 2,300.00"), which read as a malformed token.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(amount)
}

/**
 * Format a Date as YYYY-MM-DD using the LOCAL timezone.
 * Use for <input type="date"> values — avoid toISOString() which shifts to UTC
 * and can produce the wrong day near midnight.
 */
export function formatDateForInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}

/**
 * Format an INSTANT (createdAt, startTime, lastLoginAt...) in the viewer's
 * local zone, in the APP's language (pass i18n.language), e.g. "12 oct 2026".
 *
 * INSTANTS ONLY. A calendar-day field (payment date, expense date, labwork
 * date, budget validUntil, patient dob) is stored as UTC midnight of the day
 * the user picked, so rendering it here shows the previous day for any viewer
 * west of UTC: use formatCalendarDay instead.
 *
 * Never call toLocaleDateString without a locale: that reads the browser's
 * locale, so one screen can render dates in a format no other screen uses.
 */
export function formatShortDate(iso: string | Date, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, SHORT_DATE_OPTIONS)
}

/**
 * Format a CALENDAR DAY (a day the user typed into a date input) in the APP's
 * language, e.g. "28 oct 2026". The API stores these as UTC midnight, so the
 * value is read in UTC: the day that comes back is the day that was entered,
 * whatever zone the viewer is in.
 *
 * CALENDAR DAYS ONLY. Passing a real instant here would show the UTC day,
 * which is the following day for a late-evening time west of UTC: use
 * formatShortDate for those.
 */
export function formatCalendarDay(
  iso: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = SHORT_DATE_OPTIONS
): string {
  return new Date(iso).toLocaleDateString(locale, { ...options, timeZone: 'UTC' })
}
