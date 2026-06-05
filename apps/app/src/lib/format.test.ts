import { describe, it, expect } from 'vitest'
import { formatCurrency, formatDateForInput } from './format'

describe('formatCurrency', () => {
  it('renders the ISO code followed by the amount', () => {
    expect(formatCurrency(2300, 'UYU')).toMatch(/^UYU\s2,300\.00$/)
  })

  it('defaults to USD when no currency is provided', () => {
    expect(formatCurrency(1234.5)).toMatch(/^USD\s1,234\.50$/)
  })

  it('keeps amounts unambiguous across currencies sharing the "$" symbol', () => {
    expect(formatCurrency(100, 'ARS')).toMatch(/^ARS\s100\.00$/)
    expect(formatCurrency(100, 'UYU')).toMatch(/^UYU\s100\.00$/)
  })

  it('never emits the legacy "$(CODE)" token', () => {
    expect(formatCurrency(50, 'UYU')).not.toContain('$(')
  })
})

describe('formatDateForInput', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(formatDateForInput(new Date(2026, 5, 5))).toBe('2026-06-05')
  })
})
