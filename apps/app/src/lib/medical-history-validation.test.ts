import { describe, it, expect } from 'vitest'
import type { MedicalHistoryEntry } from '@dental/shared'
import {
  validateMedicalEntries,
  MEDICAL_ENTRY_MAX_LENGTH,
  MEDICAL_SECTION_MAX_ENTRIES,
} from './medical-history-validation'

const entry = (text: string, criticality: MedicalHistoryEntry['criticality'] = 'normal') => ({
  text,
  criticality,
})

describe('validateMedicalEntries', () => {
  it('exports the limits the API enforces', () => {
    expect(MEDICAL_ENTRY_MAX_LENGTH).toBe(500)
    expect(MEDICAL_SECTION_MAX_ENTRIES).toBe(50)
  })

  it('accepts an empty list (clearing a section)', () => {
    expect(validateMedicalEntries([])).toEqual({ entries: [], errors: {}, section: undefined, valid: true })
  })

  it('trims text and keeps criticality', () => {
    const result = validateMedicalEntries([entry('  uno  ', 'critical'), entry('dos')])
    expect(result.valid).toBe(true)
    expect(result.entries).toEqual([entry('uno', 'critical'), entry('dos')])
  })

  it('flags an entry that is empty after trimming, by index', () => {
    const result = validateMedicalEntries([entry('ok'), entry('   ')])
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual({ 1: 'empty' })
  })

  it('accepts 500 characters and rejects 501', () => {
    expect(validateMedicalEntries([entry('a'.repeat(500))]).valid).toBe(true)
    const over = validateMedicalEntries([entry('a'.repeat(501))])
    expect(over.valid).toBe(false)
    expect(over.errors).toEqual({ 0: 'tooLong' })
  })

  it('measures length after trimming', () => {
    expect(validateMedicalEntries([entry(` ${'a'.repeat(500)} `)]).valid).toBe(true)
  })

  it.each(['a\nb', 'a\rb', 'a\r\nb'])('flags an inner line break in %j', (text) => {
    expect(validateMedicalEntries([entry(text)]).errors).toEqual({ 0: 'multiline' })
  })

  it('does not flag a trailing newline that trimming removes', () => {
    const result = validateMedicalEntries([entry('abc\n')])
    expect(result.valid).toBe(true)
    expect(result.entries[0].text).toBe('abc')
  })

  it('flags an unknown criticality', () => {
    const bad = { text: 'x', criticality: 'urgent' } as unknown as MedicalHistoryEntry
    expect(validateMedicalEntries([bad]).errors).toEqual({ 0: 'invalidCriticality' })
  })

  it('accepts 50 entries and rejects 51 with a section-level error', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => entry(`e${i}`))
    expect(validateMedicalEntries(make(50)).valid).toBe(true)
    const over = validateMedicalEntries(make(51))
    expect(over.valid).toBe(false)
    expect(over.section).toBe('tooManyEntries')
    expect(over.errors).toEqual({})
  })

  it('reports per-entry and section errors together', () => {
    const drafts = Array.from({ length: 51 }, () => entry(''))
    const result = validateMedicalEntries(drafts)
    expect(Object.keys(result.errors)).toHaveLength(51)
    expect(result.section).toBe('tooManyEntries')
  })
})
