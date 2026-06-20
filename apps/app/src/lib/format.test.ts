import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDateForInput } from './format'

describe('formatCurrency', () => {
  it('prefixes the ISO code without parentheses', () => {
    expect(formatCurrency(2300, 'UYU')).toBe('UYU 2,300.00')
    expect(formatCurrency(1234.56, 'USD')).toBe('USD 1,234.56')
  })

  it('defaults to USD when no currency is given', () => {
    expect(formatCurrency(10)).toBe('USD 10.00')
  })

  it('formats zero and negative amounts', () => {
    expect(formatCurrency(0, 'UYU')).toBe('UYU 0.00')
    expect(formatCurrency(-50, 'USD')).toBe('-USD 50.00')
  })

  it('never emits the legacy "$(CODE)" rendering', () => {
    expect(formatCurrency(2300, 'UYU')).not.toContain('(')
  })
})

describe('formatDateForInput', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(formatDateForInput(new Date(2026, 5, 9))).toBe('2026-06-09')
  })
})
