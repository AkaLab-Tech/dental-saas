/**
 * Format a number as currency using the ISO code as a prefix.
 * Output: "UYU 2,300.00" — CODE + space + amount.
 *
 * Uses `currencyDisplay: 'code'` so every currency is disambiguated by its
 * ISO code (many currencies share the bare "$" narrow symbol — USD, UYU, ARS,
 * …), while still rendering a clean, parenthesis-free value.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  })
    .format(amount)
    // Intl separates the code from the amount with a non-breaking space
    // (U+00A0 / U+202F); normalize to a regular space for predictable output.
    .replace(/[\u00A0\u202F]/g, ' ')
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
