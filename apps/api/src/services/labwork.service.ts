import { prisma, Prisma, LabworkStatus } from '@dental/database'
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
  status: true,
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

const DOCTOR_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  isActive: true,
} as const

type DoctorSummary = {
  id: string
  firstName: string
  lastName: string
  isActive: boolean
}

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
  status: LabworkStatus
  doctorIds: string[]
  doctors: DoctorSummary[]
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
  | 'DOCTOR_NOT_FOUND'
  | 'INVALID_STATUS'

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
  status?: LabworkStatus
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
  status?: LabworkStatus
  doctorIds?: string[]
}

export interface ListLabworksOptions {
  limit?: number
  offset?: number
  includeInactive?: boolean
  patientId?: string
  isPaid?: boolean
  isDelivered?: boolean
  status?: LabworkStatus | LabworkStatus[]
  overdue?: boolean
  from?: Date
  to?: Date
  search?: string
}

/**
 * Result of resolving the lifecycle `status` + `isDelivered` pair for a
 * write. Kept in lockstep: isDelivered === (status === 'RECEIVED').
 */
export type ResolveLifecycleResult =
  | { success: true; status: LabworkStatus; isDelivered: boolean }
  | { success: false; code: 'INVALID_STATUS' }

/**
 * Resolve the `status` + `isDelivered` pair to persist, keeping
 * isDelivered === (status === 'RECEIVED') on every write (task #243).
 *
 * - `status` given: isDelivered is derived from it. If `isDelivered` was
 *   also given and disagrees with that derivation, the pair is
 *   contradictory -> INVALID_STATUS.
 * - only `isDelivered` given: `true` -> RECEIVED. `false` -> keep `current`
 *   unless `current` is RECEIVED (-> SENT) or there is no `current` at all,
 *   i.e. a fresh row (-> PENDING, the schema default for new rows).
 * - neither given: same outcome as `isDelivered: false` (fresh-row default,
 *   or "leave it alone" when `current` already holds a non-RECEIVED status).
 */
export function resolveLifecycle(
  input: { status?: LabworkStatus; isDelivered?: boolean },
  current?: LabworkStatus
): ResolveLifecycleResult {
  if (input.status !== undefined) {
    const impliedIsDelivered = input.status === LabworkStatus.RECEIVED
    if (input.isDelivered !== undefined && input.isDelivered !== impliedIsDelivered) {
      return { success: false, code: 'INVALID_STATUS' }
    }
    return { success: true, status: input.status, isDelivered: impliedIsDelivered }
  }

  if (input.isDelivered) {
    return { success: true, status: LabworkStatus.RECEIVED, isDelivered: true }
  }

  if (current === undefined) {
    return { success: true, status: LabworkStatus.PENDING, isDelivered: false }
  }

  return {
    success: true,
    status: current === LabworkStatus.RECEIVED ? LabworkStatus.SENT : current,
    isDelivered: false,
  }
}

/**
 * Server-local start of today, used as the boundary for the "overdue" derived state.
 * A labwork due today is not overdue; only strictly-past dates are.
 */
function getStartOfToday(): Date {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return startOfToday
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
  status: LabworkStatus
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
    doctors: [],
  }
}

/**
 * Resolve `doctorIds` into `doctors` (id, name, isActive) for a batch of
 * labworks with a single query, regardless of how many labworks are passed.
 * Deactivated doctors still resolve; ids matching no doctor of this tenant
 * are silently dropped from `doctors` (they remain in `doctorIds`).
 */
async function attachDoctors(tenantId: string, labworks: SafeLabwork[]): Promise<SafeLabwork[]> {
  const doctorIds = Array.from(new Set(labworks.flatMap((l) => l.doctorIds)))
  const doctors = doctorIds.length
    ? await prisma.doctor.findMany({
        where: { id: { in: doctorIds }, tenantId },
        select: DOCTOR_SUMMARY_SELECT,
      })
    : []
  const doctorsById = new Map(doctors.map((d) => [d.id, d]))

  return labworks.map((labwork) => ({
    ...labwork,
    doctors: labwork.doctorIds
      .map((id) => doctorsById.get(id))
      .filter((d): d is DoctorSummary => !!d),
  }))
}

/**
 * Verify every id in `doctorIds` belongs to a doctor of this tenant. Does
 * NOT filter on `isActive` — a labwork can keep a deactivated doctor it was
 * already assigned to.
 */
async function verifyDoctors(
  doctorIds: string[],
  tenantId: string
): Promise<{ success: true } | { success: false; code: LabworkErrorCode }> {
  const uniqueIds = Array.from(new Set(doctorIds))
  if (uniqueIds.length === 0) {
    return { success: true }
  }

  const doctors = await prisma.doctor.findMany({
    where: { id: { in: uniqueIds }, tenantId },
    select: { id: true },
  })

  if (doctors.length !== uniqueIds.length) {
    return { success: false, code: 'DOCTOR_NOT_FOUND' }
  }

  return { success: true }
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

  // Validate doctors if provided
  if (input.doctorIds) {
    const doctorsCheck = await verifyDoctors(input.doctorIds, tenantId)
    if (!doctorsCheck.success) {
      return doctorsCheck
    }
  }

  // priceIncludedInAppointment requires appointmentId
  const priceIncluded = input.appointmentId ? (input.priceIncludedInAppointment || false) : false

  const lifecycle = resolveLifecycle({ status: input.status, isDelivered: input.isDelivered })
  if (!lifecycle.success) {
    return lifecycle
  }

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
      isDelivered: lifecycle.isDelivered,
      status: lifecycle.status,
      doctorIds: input.doctorIds || [],
      createdBy: input.createdBy,
    },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId: labwork.id, tenantId }, 'Labwork created')

  const [withDoctors] = await attachDoctors(tenantId, [transformLabwork(labwork)])
  return { success: true, data: withDoctors }
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

  const [withDoctors] = await attachDoctors(tenantId, [transformLabwork(labwork)])
  return { success: true, data: withDoctors }
}

/**
 * Build the shared Prisma where-clause for filtering labworks, used by both
 * the paginated list and the unpaginated CSV export.
 */
function buildLabworksWhere(
  tenantId: string,
  options?: Omit<ListLabworksOptions, 'limit' | 'offset'>
): Prisma.LabworkWhereInput {
  const dateFilter = (options?.from || options?.to || options?.overdue)
    ? {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
        ...(options.overdue && { lt: getStartOfToday() }),
      }
    : undefined

  return {
    tenantId,
    ...(options?.includeInactive ? {} : { isActive: true }),
    ...(options?.patientId && { patientId: options.patientId }),
    ...(options?.isPaid !== undefined && { isPaid: options.isPaid }),
    ...(options?.isDelivered !== undefined
      ? { isDelivered: options.isDelivered }
      : options?.overdue && { isDelivered: false }),
    ...(options?.status !== undefined && {
      status: Array.isArray(options.status) ? { in: options.status } : options.status,
    }),
    ...(dateFilter && { date: dateFilter }),
    ...(options?.search && {
      OR: [
        { lab: { contains: options.search, mode: 'insensitive' } },
        { patient: { firstName: { contains: options.search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: options.search, mode: 'insensitive' } } },
      ],
    }),
  }
}

/**
 * List labworks for a tenant
 */
export async function listLabworks(
  tenantId: string,
  options?: ListLabworksOptions
): Promise<{ data: SafeLabwork[]; total: number }> {
  const where = buildLabworksWhere(tenantId, options)

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
    data: await attachDoctors(tenantId, labworks.map(transformLabwork)),
    total,
  }
}

const CSV_HEADERS = ['Fecha', 'Laboratorio', 'Teléfono', 'Paciente', 'Doctor(es)', 'Precio', 'Pagado', 'Entregado', 'Nota']

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Serialize labworks to CSV rows (header included). Pure function so tests can
 * exercise it directly without a database.
 */
export function labworksToCsv(labworks: SafeLabwork[], doctorNamesById: Record<string, string>): string {
  const rows = labworks.map((labwork) => {
    const patientName = labwork.patient ? `${labwork.patient.firstName} ${labwork.patient.lastName}` : ''
    const doctorNames = labwork.doctorIds.map((id) => doctorNamesById[id] || id).join('; ')

    return [
      labwork.date.toISOString().split('T')[0],
      labwork.lab,
      labwork.phoneNumber || '',
      patientName,
      doctorNames,
      labwork.price.toString(),
      labwork.isPaid ? 'Sí' : 'No',
      labwork.isDelivered ? 'Sí' : 'No',
      labwork.note || '',
    ]
      .map(csvEscape)
      .join(',')
  })

  return [CSV_HEADERS.join(','), ...rows].join('\n')
}

/**
 * Export labworks matching the given filters as a CSV string, with no pagination cap.
 */
export async function exportLabworksCsv(
  tenantId: string,
  options?: Omit<ListLabworksOptions, 'limit' | 'offset'>
): Promise<string> {
  const where = buildLabworksWhere(tenantId, options)

  const labworks = await prisma.labwork.findMany({
    where,
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
    orderBy: { date: 'desc' },
  })

  const withDoctors = await attachDoctors(tenantId, labworks.map(transformLabwork))
  const doctorNamesById = Object.fromEntries(
    withDoctors.flatMap((l) => l.doctors.map((d) => [d.id, `${d.firstName} ${d.lastName}`]))
  )

  return labworksToCsv(withDoctors, doctorNamesById)
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
    select: { id: true, patientId: true, appointmentId: true, status: true },
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

  // Validate doctors if being updated
  if (input.doctorIds) {
    const doctorsCheck = await verifyDoctors(input.doctorIds, tenantId)
    if (!doctorsCheck.success) {
      return doctorsCheck
    }
  }

  // Determine effective appointmentId for priceIncluded logic
  const effectiveAppointmentId = input.appointmentId !== undefined ? input.appointmentId : existing.appointmentId
  const priceIncluded = effectiveAppointmentId
    ? (input.priceIncludedInAppointment ?? false)
    : false

  let lifecycle: { status: LabworkStatus; isDelivered: boolean } | undefined
  if (input.status !== undefined || input.isDelivered !== undefined) {
    const resolved = resolveLifecycle({ status: input.status, isDelivered: input.isDelivered }, existing.status)
    if (!resolved.success) {
      return resolved
    }
    lifecycle = { status: resolved.status, isDelivered: resolved.isDelivered }
  }

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
      ...(lifecycle && { isDelivered: lifecycle.isDelivered, status: lifecycle.status }),
      ...(input.doctorIds && { doctorIds: input.doctorIds }),
    },
    select: {
      ...LABWORK_SELECT,
      patient: { select: PATIENT_INCLUDE },
    },
  })

  logger.info({ labworkId, tenantId }, 'Labwork updated')

  const [withDoctors] = await attachDoctors(tenantId, [transformLabwork(labwork)])
  return { success: true, data: withDoctors }
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

  const [withDoctors] = await attachDoctors(tenantId, [transformLabwork(updated)])
  return { success: true, data: withDoctors }
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

  const [withDoctors] = await attachDoctors(tenantId, [transformLabwork(updated)])
  return { success: true, data: withDoctors }
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
  overdue: number
  totalValue: number
  paidValue: number
  unpaidValue: number
}> {
  const dateFilter = (options?.from || options?.to)
    ? {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      }
    : undefined

  const where: Prisma.LabworkWhereInput = {
    tenantId,
    isActive: true,
    ...(dateFilter && { date: dateFilter }),
  }

  const [total, paid, delivered, overdue, aggregate, paidAggregate] = await Promise.all([
    prisma.labwork.count({ where }),
    prisma.labwork.count({ where: { ...where, isPaid: true } }),
    prisma.labwork.count({ where: { ...where, isDelivered: true } }),
    prisma.labwork.count({
      where: { ...where, isDelivered: false, date: { ...dateFilter, lt: getStartOfToday() } },
    }),
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
    overdue,
    totalValue,
    paidValue,
    unpaidValue: totalValue - paidValue,
  }
}
