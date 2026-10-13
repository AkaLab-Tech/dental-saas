/**
 * Medical history: five free-text sections per patient, each holding entries
 * that carry their own criticality.
 *
 * Storage format (see the comment on `Patient` in schema.prisma): one entry per
 * line, `[<criticality>] <text>`. The column stays plain searchable text while
 * each entry can still be highlighted on its own.
 */

/** Closed set of criticality levels. `critical` is the paper chart's highlighter. */
export const MEDICAL_CRITICALITIES = ['critical', 'normal'] as const
export type MedicalCriticality = (typeof MEDICAL_CRITICALITIES)[number]

/** The five sections, which are also the `Patient` column names. */
export const MEDICAL_HISTORY_FIELDS = [
  'allergies',
  'currentMedication',
  'conditions',
  'previousSurgeries',
  'medicalNotes',
] as const
export type MedicalHistoryField = (typeof MEDICAL_HISTORY_FIELDS)[number]

export interface MedicalHistoryEntry {
  text: string
  criticality: MedicalCriticality
}

export type MedicalHistory = Record<MedicalHistoryField, MedicalHistoryEntry[]>

const LINE_PATTERN = new RegExp(`^\\[(${MEDICAL_CRITICALITIES.join('|')})\\] (.*)$`)

/**
 * Serialise entries to the stored text. An empty list becomes null so a cleared
 * section is indistinguishable from one never filled in.
 */
export function serializeMedicalEntries(entries: MedicalHistoryEntry[]): string | null {
  if (entries.length === 0) return null
  return entries.map((e) => `[${e.criticality}] ${e.text}`).join('\n')
}

/**
 * Parse stored text back to entries. A line without a recognised token (text
 * written outside this API) is kept verbatim as a `normal` entry rather than dropped.
 */
export function parseMedicalEntries(stored: string | null): MedicalHistoryEntry[] {
  if (!stored) return []
  return stored
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const match = LINE_PATTERN.exec(line)
      return match
        ? { criticality: match[1] as MedicalCriticality, text: match[2] }
        : { criticality: 'normal' as const, text: line }
    })
}
