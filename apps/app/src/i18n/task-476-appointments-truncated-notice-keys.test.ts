/**
 * i18n key-parity check for task #476 (the appointments list notice shown when
 * the server cap hides part of a month). The notice must exist in every
 * locale and carry both interpolation slots, otherwise one language renders
 * the raw key or loses the "X of Y" numbers that are the whole point.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

describe('task #476 i18n — appointments.truncatedNotice', () => {
  it.each(Object.keys(locales))('%s has the key with {{shown}} and {{total}}', (code) => {
    const value = (locales as Record<string, { appointments: Record<string, unknown> }>)[code].appointments
      .truncatedNotice
    expect(value, `${code}.json is missing appointments.truncatedNotice`).toBeTypeOf('string')
    expect(value as string).toContain('{{shown}}')
    expect(value as string).toContain('{{total}}')
  })
})
