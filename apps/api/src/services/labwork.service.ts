import { prisma, Prisma } from '@dental/database'
import { logger } from '../utils/logger.js'

// Fields to include in labwork responses
const LABWORK_SELECT = {
  id: true,
  tenantId: true,
  patientId: true,
  appointmentId: true,
  priceIncludedInAppointment: true,
  lab: true,
  phoneNumber: true,
  date: true,
  note: true,
  price: true,
  isPaid: true,
  isDelivered: true,
  doctorIds: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const

const PATIENT_INCLUDE = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const

export type SafeLabwork = {
  id: string
  tenantId: string
  patientId: string | null
  appointmentId: string | null
  priceIncludedInAppointment: boolean
  lab: string
  phoneNumber: string | null
  date: Date
  note: string | null
  price: Prisma.Decimal
  isPaid: boolean
  isDelivered: boolean
  doctorIds: string[]
  isActive: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  patient?: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
}

export type LabworkErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_INACTIVE'
  | 'ALREADY_ACTIVE'
  | 'INVALID_PATIENT'
  | 'INVALID_APPOINTMENT'

export interface CreateLabworkInput {
  patientId?: string
  appointmentId?: string
  priceIncludedInAppointment?: boolean
  lab: string
  phoneNumber?: string
  date: Date
  note?: string
  price?: number
  isPaid?: boolean
  isDelivered?: boolean
  doctorIds?: string[]
  createdBy?: string
}

export interface UpdateLabworkInput {
  patientId?: string | null
  appointmentId?: string | null
  priceIncludedInAppointment?: boolean
  lab?: string
  phoneNumber?: string | null
  date?: Date
  note?: string | null
  price?: number
  isPaid?: boolean
  isDelivered?: boolean
  doctorIds?: string[]
}

export interface ListLabworksOptions {
  limit?: number
  offset?: number
  includeInactive?: boolean
  patientId?: string
  isPaid?: boolean
  isDelivered?: boolean
  from?: Date
  to?: Date
  search?: string
}

/**
 * Transform database labwork to safe response format
 */
function transformLabwork(labwork: {
  id: string
  tenantId: string
  patientId: string | null
  appointmentId: string | null
  priceIncludedInAppointment: boolean
  lab: string
  phoneNumber: string | null
  date: Date
  note: string | null
  price: Prisma.Decimal
  isPaid: boolean
  isDelivered: boolean
  doctorIds: Prisma.JsonValue
  isActive: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  patient?: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
}): SafeLabwork {
  return {
    ...labwork,
    doctorIds: Array.isArray(labwork.doctorIds) ? labwork.doctorIds as string[] : [],
  }
}

/**
 * Count labworks for a tenant
 */
export async function countLabworks(
  tenantId: string,
  options?: { from?: Date; to?: Date; isPaid?: boolean; isDelivered?: boolean }
): Promise<number> {
  const where: Prisma.LabworkWhereInput = {
    tenantId,
    isActive: true,
    ...(options?.isPaid !== undefined && { isPaid: options.isPaid }),
    ...(options?.isDelivered !== undefined && { isDelivered: options.isDelivered }),
    ...((options?.from || options?.to) && {
      date: {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      },
    }),
  }

  return prisma.labwork.count({ where })
}

/**
 * Verify patient belongs to tenant
 */
async function verifyPatient(
  patientId: string,
  tenantId: string
): Promise<{ success: true } | { success: false; code: LabworkErrorCode }> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId, isActive: true },
    select: { id: true },
  })

  if (!patient) {
    return { success: false, code: 'INVALID_PATIENT' }
  }

  return { success: true }
}

/**
 * Verify appointment belongs to tenant and same patient
 */
async function verifyAppointment(
  appointmentId: string,
  tenantId: string,
  patientId: string | undefined
): Promise<{ success: true } | { success: false; code: LabworkErrorCode }> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId, isActive: true },
    select: { id: true, patientId: true },
  })

  if (!appointment || (patientId && appointment.patientId !== patientId)) {
    return { success: false, code: 'INVALID_APPOINTMENT' }
  }

  return { success: true }
}

/**
 * Create a new labwork
 */
export async function createLabwork(
  tenantId: string,
  input: CreateLabworkInput
): Promise<{ success: true; data: SafeLabwork } | { success: false; code: LabworkErrorCode }> {
  // Validate patient if provided
  if (input.patientId) {
    const patientCheck = await verifyPatient(input.patientId, tenantId)
    if (!patientCheck.success) {
      return patientCheck
    }
  }

  // Validate appointment if provided
  if (input.appointmentId) {
    const appointmentCheck = await verifyAppointment(input.appointmentId, tenantId, input.patientId)
    if (!appointmentCheck.success) {
      return appointmentCheck
    }
  }

  // priceIncludedInAppointment requires appointmentId
  const priceIncluded = input.appointmentId ? (input.priceIncludedInAppointment || false) : false

  const labwork = await prisma.labwork.create({
    data: {
      tenantId,
      patientId: input.patientId || null,
      appointmentId: input.appointmentId || null,
      priceIncludedInAppointment: priceIncluded,
      lab: input.lab,
      phoneNumber: input.phoneNumber || null,
      date: input.date,
      note: input.note || null,
      price: input.price || 0,
      isPaid: priceIncluded ? true : (input.isPaid || false),
      isDelivered: input.isDelivered || false,
      doctorIds: input.doctorIds || [],
      createdBy: input.createdBy,
    },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId: labwork.id, tenantId }, 'Labwork created')

  return { success: true, data: transformLabwork(labwork) }
}

/**
 * Get a labwork by ID
 */
export async function getLabworkById(
  tenantId: string,
  labworkId: string
): Promise<{ success: true; data: SafeLabwork } | { success: false; code: LabworkErrorCode }> {
  const labwork = await prisma.labwork.findFirst({
    where: { id: labworkId, tenantId },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  if (!labwork) {
    return { success: false, code: 'NOT_FOUND' }
  }

  return { success: true, data: transformLabwork(labwork) }
}

/**
 * List labworks for a tenant
 */
export async function listLabworks(
  tenantId: string,
  options?: ListLabworksOptions
): Promise<{ data: SafeLabwork[]; total: number }> {
  const where: Prisma.LabworkWhereInput = {
    tenantId,
    ...(options?.includeInactive ? {} : { isActive: true }),
    ...(options?.patientId && { patientId: options.patientId }),
    ...(options?.isPaid !== undefined && { isPaid: options.isPaid }),
    ...(options?.isDelivered !== undefined && { isDelivered: options.isDelivered }),
    ...((options?.from || options?.to) && {
      date: {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      },
    }),
    ...(options?.search && {
      OR: [
        { lab: { contains: options.search, mode: 'insensitive' } },
        { patient: { firstName: { contains: options.search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: options.search, mode: 'insensitive' } } },
      ],
    }),
  }

  const [labworks, total] = await Promise.all([
    prisma.labwork.findMany({
      where,
      select: {
        ...LABWORK_SELECT,
        patient: { select: PATIENT_INCLUDE },
      },
      orderBy: { date: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.labwork.count({ where }),
  ])

  return {
    data: labworks.map(transformLabwork),
    total,
  }
}

/**
 * List distinct laboratory names previously used by a tenant, for autocomplete
 */
export async function listLabNames(tenantId: string): Promise<string[]> {
  const labworks = await prisma.labwork.findMany({
    where: { tenantId, isActive: true },
    distinct: ['lab'],
    select: { lab: true },
    orderBy: { lab: 'asc' },
  })

  return labworks.map((l) => l.lab).filter((lab) => lab.length > 0)
}

/**
 * Update a labwork
 */
export async function updateLabwork(
  tenantId: string,
  labworkId: string,
  input: UpdateLabworkInput
): Promise<{ success: true; data: SafeLabwork } | { success: false; code: LabworkErrorCode }> {
  // Check labwork exists
  const existing = await prisma.labwork.findFirst({
    where: { id: labworkId, tenantId },
    select: { id: true, patientId: true, appointmentId: true },
  })

  if (!existing) {
    return { success: false, code: 'NOT_FOUND' }
  }

  // Validate patient if being updated
  if (input.patientId) {
    const patientCheck = await verifyPatient(input.patientId, tenantId)
    if (!patientCheck.success) {
      return patientCheck
    }
  }

  // Validate appointment if being updated
  const effectivePatientId = input.patientId !== undefined ? input.patientId : existing.patientId
  if (input.appointmentId) {
    const appointmentCheck = await verifyAppointment(input.appointmentId, tenantId, effectivePatientId || undefined)
    if (!appointmentCheck.success) {
      return appointmentCheck
    }
  }

  // Determine effective appointmentId for priceIncluded logic
  const effectiveAppointmentId = input.appointmentId !== undefined ? input.appointmentId : existing.appointmentId
  const priceIncluded = effectiveAppointmentId
    ? (input.priceIncludedInAppointment ?? false)
    : false

  const labwork = await prisma.labwork.update({
    where: { id: labworkId },
    data: {
      ...(input.patientId !== undefined && { patientId: input.patientId }),
      ...(input.appointmentId !== undefined && { appointmentId: input.appointmentId }),
      ...(input.priceIncludedInAppointment !== undefined || input.appointmentId !== undefined
        ? { priceIncludedInAppointment: priceIncluded }
        : {}),
      ...(input.lab && { lab: input.lab }),
      ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
      ...(input.date && { date: input.date }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.price !== undefined && { price: input.price }),
      ...(input.isPaid !== undefined && { isPaid: input.isPaid }),
      ...(input.isDelivered !== undefined && { isDelivered: input.isDelivered }),
      ...(input.doctorIds && { doctorIds: input.doctorIds }),
    },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId, tenantId }, 'Labwork updated')

  return { success: true, data: transformLabwork(labwork) }
}

/**
 * Soft delete a labwork
 */
export async function deleteLabwork(
  tenantId: string,
  labworkId: string
): Promise<{ success: true; data: SafeLabwork } | { success: false; code: LabworkErrorCode }> {
  const labwork = await prisma.labwork.findFirst({
    where: { id: labworkId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!labwork) {
    return { success: false, code: 'NOT_FOUND' }
  }

  if (!labwork.isActive) {
    return { success: false, code: 'ALREADY_INACTIVE' }
  }

  const updated = await prisma.labwork.update({
    where: { id: labworkId },
    data: { isActive: false },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId, tenantId }, 'Labwork soft deleted')

  return { success: true, data: transformLabwork(updated) }
}

/**
 * Restore a soft-deleted labwork
 */
export async function restoreLabwork(
  tenantId: string,
  labworkId: string
): Promise<{ success: true; data: SafeLabwork } | { success: false; code: LabworkErrorCode }> {
  const labwork = await prisma.labwork.findFirst({
    where: { id: labworkId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!labwork) {
    return { success: false, code: 'NOT_FOUND' }
  }

  if (labwork.isActive) {
    return { success: false, code: 'ALREADY_ACTIVE' }
  }

  const updated = await prisma.labwork.update({
    where: { id: labworkId },
    data: { isActive: true },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId, tenantId }, 'Labwork restored')

  return { success: true, data: transformLabwork(updated) }
}

/**
 * Get labwork statistics for a tenant
 */
export async function getLabworkStats(
  tenantId: string,
  options?: { from?: Date; to?: Date }
): Promise<{
  total: number
  paid: number
  unpaid: number
  delivered: number
  pending: number
  totalValue: number
  paidValue: number
  unpaidValue: number
}> {
  const where: Prisma.LabworkWhereInput = {
    tenantId,
    isActive: true,
    ...((options?.from || options?.to) && {
      date: {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      },
    }),
  }

  const [total, paid, delivered, aggregate, paidAggregate] = await Promise.all([
    prisma.labwork.count({ where }),
    prisma.labwork.count({ where: { ...where, isPaid: true } }),
    prisma.labwork.count({ where: { ...where, isDelivered: true } }),
    prisma.labwork.aggregate({
      where,
      _sum: { price: true },
    }),
    prisma.labwork.aggregate({
      where: { ...where, isPaid: true },
      _sum: { price: true },
    }),
  ])

  const totalValue = aggregate._sum.price?.toNumber() || 0
  const paidValue = paidAggregate._sum.price?.toNumber() || 0

  return {
    total,
    paid,
    unpaid: total - paid,
    delivered,
    pending: total - delivered,
    totalValue,
    paidValue,
    unpaidValue: totalValue - paidValue,
  }
}
