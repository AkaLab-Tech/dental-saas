import { prisma, Prisma } from '@dental/database'
import { getTenantPlanLimits } from './user.service.js'
import { logger } from '../utils/logger.js'
import { ToothStatus, type ToothData, type TeethData } from '@dental/shared'

// Prisma JsonNull helper for nullable JSON fields
const JsonNull = Prisma.JsonNull

// Type for JSON input values
type JsonInputValue = Prisma.InputJsonValue

// Fields to include in patient responses
const PATIENT_SELECT = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dob: true,
  gender: true,
  address: true,
  notes: true,
  teeth: true,
  showPrimaryTeeth: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

export type SafePatient = {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  dob: Date | null
  gender: string | null
  address: string | null
  notes: Prisma.JsonValue
  teeth: Prisma.JsonValue
  showPrimaryTeeth: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Threshold below which a patient is assumed to still have primary teeth.
 * All permanent teeth (excluding third molars) have typically erupted by age 12.
 */
const PRIMARY_TEETH_AGE_THRESHOLD = 12

/**
 * Returns true if the given date of birth places the person strictly under
 * PRIMARY_TEETH_AGE_THRESHOLD at the current moment.
 */
function isUnderPrimaryTeethAge(dob: Date): boolean {
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age--
  }
  return age < PRIMARY_TEETH_AGE_THRESHOLD
}

/**
 * Error codes for patient operations
 */
export type PatientErrorCode = 'NOT_FOUND' | 'ALREADY_INACTIVE' | 'ALREADY_ACTIVE' | 'PLAN_LIMIT_EXCEEDED'

/**
 * Count active patients for a tenant
 */
export async function countPatients(tenantId: string): Promise<number> {
  return prisma.patient.count({
    where: { tenantId, isActive: true },
  })
}

/**
 * Check if adding a new patient would exceed plan limits
 */
export async function checkPatientLimit(
  tenantId: string
): Promise<{ allowed: boolean; message?: string; currentCount?: number; limit?: number }> {
  const limits = await getTenantPlanLimits(tenantId)
  const currentCount = await countPatients(tenantId)

  if (currentCount >= limits.maxPatients) {
    return {
      allowed: false,
      message: `Patient limit reached. Your plan allows ${limits.maxPatients} patient(s). Upgrade to add more.`,
      currentCount,
      limit: limits.maxPatients,
    }
  }

  return { allowed: true, currentCount, limit: limits.maxPatients }
}

/**
 * List all patients for a tenant
 */
export async function listPatients(
  tenantId: string,
  options?: { limit?: number; offset?: number; includeInactive?: boolean; search?: string }
): Promise<SafePatient[]> {
  const { limit = 50, offset = 0, includeInactive = false, search } = options || {}

  const where: Prisma.PatientWhereInput = {
    tenantId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const patients = await prisma.patient.findMany({
    where,
    select: PATIENT_SELECT,
    take: Math.min(limit, 100),
    skip: offset,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  return patients
}

/**
 * Get a single patient by ID (with tenant isolation)
 */
export async function getPatientById(tenantId: string, patientId: string): Promise<SafePatient | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: PATIENT_SELECT,
  })

  return patient
}

/**
 * Create a new patient for a tenant
 */
export async function createPatient(
  tenantId: string,
  data: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    dob?: Date | string
    gender?: string
    address?: string
    notes?: JsonInputValue
    createdBy?: string
  }
): Promise<SafePatient> {
  const { firstName, lastName, email, phone, dob, gender, address, notes, createdBy } = data

  // Handle date of birth - convert string to Date if needed
  let dobValue: Date | undefined
  if (dob) {
    dobValue = typeof dob === 'string' ? new Date(dob) : dob
  }

  const showPrimaryTeeth = dobValue ? isUnderPrimaryTeethAge(dobValue) : false

  const patient = await prisma.patient.create({
    data: {
      tenantId,
      firstName,
      lastName,
      email,
      phone,
      dob: dobValue,
      gender,
      address,
      notes: notes ?? JsonNull,
      showPrimaryTeeth,
      createdBy,
    },
    select: PATIENT_SELECT,
  })

  logger.info({ patientId: patient.id, tenantId }, 'Patient created')

  return patient
}

/**
 * Update a patient
 */
export async function updatePatient(
  tenantId: string,
  patientId: string,
  data: {
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    dob?: Date | string | null
    gender?: string | null
    address?: string | null
    notes?: JsonInputValue | null
    isActive?: boolean
  }
): Promise<SafePatient | null> {
  // Verify patient belongs to tenant
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return null
  }

  // Transform data for Prisma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaData: Record<string, any> = { ...data }

  // Handle notes null
  if (data.notes !== undefined) {
    prismaData.notes = data.notes === null ? JsonNull : data.notes
  }

  // Handle dob - convert string to Date if provided
  if (data.dob !== undefined) {
    if (data.dob === null) {
      prismaData.dob = null
    } else if (typeof data.dob === 'string') {
      prismaData.dob = new Date(data.dob)
    }
  }

  const patient = await prisma.patient.update({
    where: { id: patientId },
    data: prismaData,
    select: PATIENT_SELECT,
  })

  logger.info({ patientId, tenantId }, 'Patient updated')

  return patient
}

/**
 * Soft delete a patient (set isActive = false)
 */
export async function deletePatient(
  tenantId: string,
  patientId: string
): Promise<{ success: boolean; error?: string; errorCode?: PatientErrorCode }> {
  // Verify patient belongs to tenant
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!existing) {
    return { success: false, error: 'Patient not found', errorCode: 'NOT_FOUND' }
  }

  if (!existing.isActive) {
    return { success: false, error: 'Patient is already inactive', errorCode: 'ALREADY_INACTIVE' }
  }

  await prisma.patient.update({
    where: { id: patientId },
    data: { isActive: false },
  })

  logger.info({ patientId, tenantId }, 'Patient deleted (soft)')

  return { success: true }
}

/**
 * Restore a soft-deleted patient
 */
export async function restorePatient(
  tenantId: string,
  patientId: string
): Promise<{ success: boolean; patient?: SafePatient; error?: string; errorCode?: PatientErrorCode }> {
  // Verify patient belongs to tenant
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!existing) {
    return { success: false, error: 'Patient not found', errorCode: 'NOT_FOUND' }
  }

  if (existing.isActive) {
    return { success: false, error: 'Patient is already active', errorCode: 'ALREADY_ACTIVE' }
  }

  // Check if restoring would exceed limits
  const limitCheck = await checkPatientLimit(tenantId)
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.message, errorCode: 'PLAN_LIMIT_EXCEEDED' }
  }

  const patient = await prisma.patient.update({
    where: { id: patientId },
    data: { isActive: true },
    select: PATIENT_SELECT,
  })

  logger.info({ patientId, tenantId }, 'Patient restored')

  return { success: true, patient }
}

/**
 * Get patient stats for a tenant
 */
export async function getPatientStats(tenantId: string) {
  const [activeCount, inactiveCount, limits] = await Promise.all([
    prisma.patient.count({ where: { tenantId, isActive: true } }),
    prisma.patient.count({ where: { tenantId, isActive: false } }),
    getTenantPlanLimits(tenantId),
  ])

  return {
    active: activeCount,
    inactive: inactiveCount,
    total: activeCount + inactiveCount,
    limit: limits.maxPatients,
    remaining: Math.max(0, limits.maxPatients - activeCount),
  }
}

/**
 * Get appointments for a patient
 */
export async function getPatientAppointments(
  tenantId: string,
  patientId: string,
  options?: { limit?: number; offset?: number }
) {
  const { limit = 20, offset = 0 } = options || {}

  // Verify patient belongs to tenant
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return null
  }

  const appointments = await prisma.appointment.findMany({
    where: { patientId, tenantId },
    take: Math.min(limit, 100),
    skip: offset,
    orderBy: { startTime: 'desc' },
    include: {
      doctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialty: true,
        },
      },
    },
  })

  return appointments
}

// Valid tooth numbers based on ISO 3950 (FDI) notation
const VALID_PERMANENT_TEETH = [
  '11', '12', '13', '14', '15', '16', '17', '18',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '31', '32', '33', '34', '35', '36', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48',
]

const VALID_PRIMARY_TEETH = [
  '51', '52', '53', '54', '55',
  '61', '62', '63', '64', '65',
  '71', '72', '73', '74', '75',
  '81', '82', '83', '84', '85',
]

const VALID_TEETH = [...VALID_PERMANENT_TEETH, ...VALID_PRIMARY_TEETH]

/**
 * Normalize teeth data to new format with backward compatibility
 * Converts old string format to new ToothData format
 */
function normalizeTeethData(teeth: Prisma.JsonValue): TeethData {
  if (!teeth || teeth === null) return {}

  const rawTeeth = teeth as Record<string, unknown>
  const normalized: TeethData = {}

  for (const [toothNumber, value] of Object.entries(rawTeeth)) {
    if (typeof value === 'string') {
      // Old format: convert to new
      normalized[toothNumber] = { note: value, status: ToothStatus.HEALTHY }
    } else if (typeof value === 'object' && value !== null) {
      // New format: use as-is
      normalized[toothNumber] = value as ToothData
    }
  }

  return normalized
}

/**
 * Validate teeth data format
 * @returns Error message if invalid, null if valid
 */
export function validateTeethData(teeth: TeethData): string | null {
  const validStatuses = [
    ToothStatus.HEALTHY,
    ToothStatus.CARIES,
    ToothStatus.FILLED,
    ToothStatus.CROWN,
    ToothStatus.ROOT_CANAL,
    ToothStatus.MISSING,
    ToothStatus.EXTRACTED,
    ToothStatus.IMPLANT,
    ToothStatus.BRIDGE,
  ]

  for (const [toothNumber, toothData] of Object.entries(teeth)) {
    if (!VALID_TEETH.includes(toothNumber)) {
      return `Invalid tooth number: ${toothNumber}. Must be a valid ISO 3950 (FDI) notation.`
    }
    if (typeof toothData !== 'object' || toothData === null) {
      return `Data for tooth ${toothNumber} must be an object with note and status.`
    }
    if (typeof toothData.note !== 'string') {
      return `Note for tooth ${toothNumber} must be a string.`
    }
    if (toothData.note.length > 1000) {
      return `Note for tooth ${toothNumber} exceeds maximum length of 1000 characters.`
    }
    if (!validStatuses.includes(toothData.status)) {
      return `Invalid status for tooth ${toothNumber}: ${toothData.status}`
    }
  }
  return null
}

/**
 * Update teeth data for a patient
 * Merges new teeth data with existing data
 */
export async function updatePatientTeeth(
  tenantId: string,
  patientId: string,
  teeth: TeethData
): Promise<{ success: true; patient: SafePatient } | { success: false; error: string; errorCode: PatientErrorCode | 'INVALID_DATA' }> {
  // Validate teeth data
  const validationError = validateTeethData(teeth)
  if (validationError) {
    return { success: false, error: validationError, errorCode: 'INVALID_DATA' }
  }

  // Get existing patient
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { ...PATIENT_SELECT },
  })

  if (!existing) {
    return { success: false, error: 'Patient not found', errorCode: 'NOT_FOUND' }
  }

  // Normalize existing teeth data (handles old string format)
  const existingTeeth = normalizeTeethData(existing.teeth)
  const mergedTeeth: TeethData = { ...existingTeeth }

  // Merge new teeth data
  // Empty note + healthy status = remove tooth entry
  for (const [toothNumber, toothData] of Object.entries(teeth)) {
    if (toothData.note === '' && toothData.status === ToothStatus.HEALTHY) {
      delete mergedTeeth[toothNumber]
    } else {
      mergedTeeth[toothNumber] = toothData
    }
  }

  // Update patient
  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: {
      teeth: Object.keys(mergedTeeth).length > 0 ? (mergedTeeth as unknown as JsonInputValue) : JsonNull,
    },
    select: PATIENT_SELECT,
  })

  logger.info(`Updated teeth for patient ${patientId} - tenantId: ${tenantId}, teethCount: ${Object.keys(mergedTeeth).length}`)

  return { success: true, patient: updated }
}

/**
 * Update the showPrimaryTeeth flag for a patient.
 */
export async function updatePatientShowPrimaryTeeth(
  tenantId: string,
  patientId: string,
  showPrimaryTeeth: boolean
): Promise<{ success: true; patient: SafePatient } | { success: false; error: string; errorCode: PatientErrorCode }> {
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return { success: false, error: 'Patient not found', errorCode: 'NOT_FOUND' }
  }

  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: { showPrimaryTeeth },
    select: PATIENT_SELECT,
  })

  return { success: true, patient: updated }
}

/**
 * Get teeth data for a patient
 */
export async function getPatientTeeth(
  tenantId: string,
  patientId: string
): Promise<{ success: true; teeth: TeethData } | { success: false; error: string; errorCode: PatientErrorCode }> {
  const existing = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { teeth: true },
  })

  if (!existing) {
    return { success: false, error: 'Patient not found', errorCode: 'NOT_FOUND' }
  }

  // Normalize teeth data (handles old string format)
  return { success: true, teeth: normalizeTeethData(existing.teeth) }
}
