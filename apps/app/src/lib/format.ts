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
