import { prisma } from '@dental/database'
import {
  parseMedicalEntries,
  serializeMedicalEntries,
  type MedicalHistory,
  type MedicalHistoryEntry,
} from '@dental/shared'
import { logger } from '../utils/logger.js'

// Explicit and per-field on purpose: one column per section, never derived by
// looping, so a mix-up between two sections cannot hide behind a shared loop.
// `address` is deliberately absent from every write below.
const MEDICAL_HISTORY_SELECT = {
  allergies: true,
  currentMedication: true,
  conditions: true,
  previousSurgeries: true,
  medicalNotes: true,
} as const

type MedicalHistoryRow = {
  allergies: string | null
  currentMedication: string | null
  conditions: string | null
  previousSurgeries: string | null
  medicalNotes: string | null
}

export type MedicalHistoryUpdate = {
  allergies?: MedicalHistoryEntry[]
  currentMedication?: MedicalHistoryEntry[]
  conditions?: MedicalHistoryEntry[]
  previousSurgeries?: MedicalHistoryEntry[]
  medicalNotes?: MedicalHistoryEntry[]
}

function toMedicalHistory(row: MedicalHistoryRow): MedicalHistory {
  return {
    allergies: parseMedicalEntries(row.allergies),
    currentMedication: parseMedicalEntries(row.currentMedication),
    conditions: parseMedicalEntries(row.conditions),
    previousSurgeries: parseMedicalEntries(row.previousSurgeries),
    medicalNotes: parseMedicalEntries(row.medicalNotes),
  }
}

function toColumn(entries: MedicalHistoryEntry[] | undefined): string | null | undefined {
  return entries === undefined ? undefined : serializeMedicalEntries(entries)
}

/**
 * Get a patient's medical history (null when the patient is not in the tenant).
 */
export async function getMedicalHistory(tenantId: string, patientId: string): Promise<MedicalHistory | null> {
  const row = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: MEDICAL_HISTORY_SELECT,
  })

  return row ? toMedicalHistory(row) : null
}

/**
 * Replace the sections present in `data`; omitted sections are left untouched.
 * An empty list clears that section.
 */
export async function updateMedicalHistory(
  tenantId: string,
  patientId: string,
  data: MedicalHistoryUpdate
): Promise<MedicalHistory | null> {
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return null
  }

  const row = await prisma.patient.update({
    where: { id: patientId },
    data: {
      allergies: toColumn(data.allergies),
      currentMedication: toColumn(data.currentMedication),
      conditions: toColumn(data.conditions),
      previousSurgeries: toColumn(data.previousSurgeries),
      medicalNotes: toColumn(data.medicalNotes),
    },
    select: MEDICAL_HISTORY_SELECT,
  })

  logger.info({ patientId, tenantId }, 'Patient medical history updated')

  return toMedicalHistory(row)
}
