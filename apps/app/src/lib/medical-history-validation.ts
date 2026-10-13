import { MEDICAL_CRITICALITIES, type MedicalHistoryEntry } from '@dental/shared'

export const MEDICAL_ENTRY_MAX_LENGTH = 500
export const MEDICAL_SECTION_MAX_ENTRIES = 50

/** i18n keys under `patients.medicalHistoryBlock.errors`. */
export type MedicalEntriesError =
  | 'empty'
  | 'tooLong'
  | 'multiline'
  | 'invalidCriticality'
  | 'tooManyEntries'

export interface MedicalEntriesValidation {
  /** Trimmed entries, ready to send. Only meaningful when `errors` is empty. */
  entries: MedicalHistoryEntry[]
  /** Error per entry index; `section` holds errors not tied to one entry. */
  errors: Record<number, MedicalEntriesError>
  section?: MedicalEntriesError
  valid: boolean
}

/**
 * Mirrors the rules of PUT /patients/:id/medical-history (single line,
 * non-empty after trim, max 500, known criticality, max 50 per section).
 * The shared serialize helpers do no validation, so the form is the first gate.
 */
export function validateMedicalEntries(drafts: MedicalHistoryEntry[]): MedicalEntriesValidation {
  const errors: Record<number, MedicalEntriesError> = {}
  const entries = drafts.map((draft) => ({ ...draft, text: draft.text.trim() }))

  entries.forEach((entry, index) => {
    if (/[\r\n]/.test(entry.text)) errors[index] = 'multiline'
    else if (entry.text.length === 0) errors[index] = 'empty'
    else if (entry.text.length > MEDICAL_ENTRY_MAX_LENGTH) errors[index] = 'tooLong'
    else if (!(MEDICAL_CRITICALITIES as readonly string[]).includes(entry.criticality)) {
      errors[index] = 'invalidCriticality'
    }
  })

  const section = entries.length > MEDICAL_SECTION_MAX_ENTRIES ? 'tooManyEntries' : undefined
  return {
    entries,
    errors,
    section,
    valid: Object.keys(errors).length === 0 && !section,
  }
}
