import { prisma, Prisma } from '@dental/database'
import { getTenantPlanLimits } from './user.service.js'
import { logger } from '../utils/logger.js'

// Prisma JsonNull helper for nullable JSON fields
const JsonNull = Prisma.JsonNull

// Fields to include in doctor responses
const DOCTOR_SELECT = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  specialty: true,
  licenseNumber: true,
  workingDays: true,
  workingHours: true,
  consultingRoom: true,
  avatar: true,
  bio: true,
  hourlyRate: true,
  userId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

export type SafeDoctor = {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  specialty: string | null
  licenseNumber: string | null
  workingDays: Prisma.JsonValue
  workingHours: Prisma.JsonValue
  consultingRoom: string | null
  avatar: string | null
  bio: string | null
  hourlyRate: Prisma.Decimal | null
  userId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Count active doctors for a tenant
 */
export async function countDoctors(tenantId: string): Promise<number> {
  return prisma.doctor.count({
    where: { tenantId, isActive: true },
  })
}

/**
 * Check if adding a new doctor would exceed plan limits
 */
export async function checkDoctorLimit(
  tenantId: string
): Promise<{ allowed: boolean; message?: string; currentCount?: number; limit?: number }> {
  const limits = await getTenantPlanLimits(tenantId)
  const currentCount = await countDoctors(tenantId)

  if (currentCount >= limits.maxDoctors) {
    return {
      allowed: false,
      message: `Doctor limit reached. Your plan allows ${limits.maxDoctors} doctor(s). Upgrade to add more.`,
      currentCount,
      limit: limits.maxDoctors,
    }
  }

  return { allowed: true, currentCount, limit: limits.maxDoctors }
}

/**
 * List all doctors for a tenant
 */
export async function listDoctors(
  tenantId: string,
  options?: { limit?: number; offset?: number; includeInactive?: boolean; search?: string }
): Promise<SafeDoctor[]> {
  const { limit = 50, offset = 0, includeInactive = false, search } = options || {}

  const where: Prisma.DoctorWhereInput = {
    tenantId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { specialty: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const doctors = await prisma.doctor.findMany({
    where,
    select: DOCTOR_SELECT,
    take: Math.min(limit, 100),
    skip: offset,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  return doctors
}

/**
 * Get a single doctor by ID (with tenant isolation)
 */
export async function getDoctorById(tenantId: string, doctorId: string): Promise<SafeDoctor | null> {
  const doctor = await prisma.doctor.findFirst({
    where: { id: doctorId, tenantId },
    select: DOCTOR_SELECT,
  })

  return doctor
}

/**
 * Create a new doctor for a tenant
 */
export async function createDoctor(
  tenantId: string,
  data: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    specialty?: string
    licenseNumber?: string
    workingDays?: string[]
    workingHours?: { start: string; end: string }
    consultingRoom?: string
    avatar?: string
    bio?: string
    hourlyRate?: number
    userId?: string
  }
): Promise<SafeDoctor> {
  const {
    firstName,
    lastName,
    email,
    phone,
    specialty,
    licenseNumber,
    workingDays,
    workingHours,
    consultingRoom,
    avatar,
    bio,
    hourlyRate,
    userId,
  } = data

  const doctor = await prisma.doctor.create({
    data: {
      tenantId,
      firstName,
      lastName,
      email,
      phone,
      specialty,
      licenseNumber,
      workingDays: workingDays || [],
      workingHours: workingHours ?? JsonNull,
      consultingRoom,
      avatar,
      bio,
      hourlyRate,
      userId,
    },
    select: DOCTOR_SELECT,
  })

  logger.info({ doctorId: doctor.id, tenantId }, 'Doctor created')

  return doctor
}

/**
 * Update a doctor
 */
export async function updateDoctor(
  tenantId: string,
  doctorId: string,
  data: {
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    specialty?: string | null
    licenseNumber?: string | null
    workingDays?: string[]
    workingHours?: { start: string; end: string } | null
    consultingRoom?: string | null
    avatar?: string | null
    bio?: string | null
    hourlyRate?: number | null
    isActive?: boolean
    userId?: string | null
  }
): Promise<SafeDoctor | null> {
  // Verify doctor belongs to tenant
  const existing = await prisma.doctor.findFirst({
    where: { id: doctorId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return null
  }

  // Transform workingHours null to Prisma.JsonNull for proper null handling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaData: Record<string, any> = { ...data }
  if (data.workingHours !== undefined) {
    prismaData.workingHours = data.workingHours === null ? JsonNull : data.workingHours
  }

  const doctor = await prisma.doctor.update({
    where: { id: doctorId },
    data: prismaData,
    select: DOCTOR_SELECT,
  })

  logger.info({ doctorId, tenantId }, 'Doctor updated')

  return doctor
}

/**
 * Soft delete a doctor (set isActive = false)
 */
export async function deleteDoctor(
  tenantId: string,
  doctorId: string
): Promise<{ success: boolean; error?: string; errorCode?: DoctorErrorCode }> {
  // Verify doctor belongs to tenant
  const existing = await prisma.doctor.findFirst({
    where: { id: doctorId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!existing) {
    return { success: false, error: 'Doctor not found', errorCode: 'NOT_FOUND' }
  }

  if (!existing.isActive) {
    return { success: false, error: 'Doctor is already inactive', errorCode: 'ALREADY_INACTIVE' }
  }

  await prisma.doctor.update({
    where: { id: doctorId },
    data: { isActive: false },
  })

  logger.info({ doctorId, tenantId }, 'Doctor deleted (soft)')

  return { success: true }
}

/**
 * Error codes for doctor operations
 */
export type DoctorErrorCode = 'NOT_FOUND' | 'ALREADY_INACTIVE' | 'ALREADY_ACTIVE' | 'PLAN_LIMIT_EXCEEDED'

/**
 * Restore a soft-deleted doctor
 */
export async function restoreDoctor(
  tenantId: string,
  doctorId: string
): Promise<{ success: boolean; doctor?: SafeDoctor; error?: string; errorCode?: DoctorErrorCode }> {
  // Verify doctor belongs to tenant
  const existing = await prisma.doctor.findFirst({
    where: { id: doctorId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!existing) {
    return { success: false, error: 'Doctor not found', errorCode: 'NOT_FOUND' }
  }

  if (existing.isActive) {
    return { success: false, error: 'Doctor is already active', errorCode: 'ALREADY_ACTIVE' }
  }

  // Check if restoring would exceed limits
  const limitCheck = await checkDoctorLimit(tenantId)
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.message, errorCode: 'PLAN_LIMIT_EXCEEDED' }
  }

  const doctor = await prisma.doctor.update({
    where: { id: doctorId },
    data: { isActive: true },
    select: DOCTOR_SELECT,
  })

  logger.info({ doctorId, tenantId }, 'Doctor restored')

  return { success: true, doctor }
}

/**
 * Get the doctor ID linked to a user account
 */
export async function getLinkedDoctorId(userId: string, tenantId: string): Promise<string | null> {
  const doctor = await prisma.doctor.findFirst({
    where: { userId, tenantId, isActive: true },
    select: { id: true },
  })
  return doctor?.id ?? null
}

/**
 * Get doctor stats for a tenant
 */
export async function getDoctorStats(tenantId: string) {
  const [activeCount, inactiveCount, limits] = await Promise.all([
    prisma.doctor.count({ where: { tenantId, isActive: true } }),
    prisma.doctor.count({ where: { tenantId, isActive: false } }),
    getTenantPlanLimits(tenantId),
  ])

  return {
    active: activeCount,
    inactive: inactiveCount,
    total: activeCount + inactiveCount,
    limit: limits.maxDoctors,
    remaining: Math.max(0, limits.maxDoctors - activeCount),
  }
}
