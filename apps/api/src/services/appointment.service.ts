import { prisma, Prisma, AppointmentStatus } from '@dental/database'
import { logger } from '../utils/logger.js'
import {
  computeFifoAllocation,
  createPayment,
  getPatientBalance,
  getTotalPaid,
  listBillableItems,
  recalculatePaidStatus,
  type PaymentErrorCode,
} from './payment.service.js'

// Fields to include in appointment responses
const APPOINTMENT_SELECT = {
  id: true,
  tenantId: true,
  patientId: true,
  doctorId: true,
  startTime: true,
  endTime: true,
  duration: true,
  status: true,
  type: true,
  notes: true,
  privateNotes: true,
  cost: true,
  isPaid: true,
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

const DOCTOR_INCLUDE = {
  id: true,
  firstName: true,
  lastName: true,
  specialty: true,
  email: true,
} as const

export type SafeAppointment = {
  id: string
  tenantId: string
  patientId: string
  doctorId: string
  startTime: Date
  endTime: Date
  duration: number
  status: AppointmentStatus
  type: string | null
  notes: string | null
  privateNotes: string | null
  cost: Prisma.Decimal | null
  isPaid: boolean
  isActive: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  // FIFO breakdown — present only on endpoints that compute it per patient
  // (getAppointmentsByPatient, getAppointmentById). undefined elsewhere.
  paidAmount?: number
  outstanding?: number
  patient?: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  }
  doctor?: {
    id: string
    firstName: string
    lastName: string
    specialty: string | null
    email: string | null
  }
}

export type AppointmentErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_INACTIVE'
  | 'ALREADY_ACTIVE'
  | 'INVALID_PATIENT'
  | 'INVALID_DOCTOR'
  | 'TIME_CONFLICT'
  | 'INVALID_TIME_RANGE'
  | 'PAST_APPOINTMENT'
  | 'CANNOT_UNMARK_PAID'
  | 'PAYMENT_FAILED'
  | 'EXCEEDS_BALANCE'

export interface CreateAppointmentInput {
  patientId: string
  doctorId: string
  startTime: Date
  endTime: Date
  duration?: number
  status?: AppointmentStatus
  type?: string
  notes?: string
  privateNotes?: string
  cost?: number
  isPaid?: boolean
  createdBy?: string
}

export interface UpdateAppointmentInput {
  patientId?: string
  doctorId?: string
  startTime?: Date
  endTime?: Date
  duration?: number
  status?: AppointmentStatus
  type?: string | null
  notes?: string | null
  privateNotes?: string | null
  cost?: number | null
  isPaid?: boolean
}

export interface ListAppointmentsOptions {
  limit?: number
  offset?: number
  includeInactive?: boolean
  doctorId?: string
  patientId?: string
  status?: AppointmentStatus
  from?: Date
  to?: Date
}

export interface CalendarOptions {
  from: Date
  to: Date
  doctorId?: string
  patientId?: string
  includeInactive?: boolean
}

/**
 * Count appointments for a tenant
 */
export async function countAppointments(
  tenantId: string,
  options?: { from?: Date; to?: Date; status?: AppointmentStatus }
): Promise<number> {
  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    isActive: true,
    ...(options?.status && { status: options.status }),
    ...(options?.from && { startTime: { gte: options.from } }),
    ...(options?.to && { startTime: { lte: options.to } }),
  }

  return prisma.appointment.count({ where })
}

/**
 * Verify patient belongs to tenant
 */
export async function verifyPatientBelongsToTenant(
  patientId: string,
  tenantId: string
): Promise<boolean> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { tenantId: true, isActive: true },
  })
  return patient?.tenantId === tenantId && patient?.isActive === true
}

/**
 * Verify doctor belongs to tenant
 */
export async function verifyDoctorBelongsToTenant(
  doctorId: string,
  tenantId: string
): Promise<boolean> {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { tenantId: true, isActive: true },
  })
  return doctor?.tenantId === tenantId && doctor?.isActive === true
}

/**
 * Check for time conflicts with existing appointments
 */
export async function checkTimeConflict(
  tenantId: string,
  doctorId: string,
  startTime: Date,
  endTime: Date,
  excludeAppointmentId?: string
): Promise<{ hasConflict: boolean; conflictingAppointment?: SafeAppointment }> {
  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    doctorId,
    isActive: true,
    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    // Check for overlapping time ranges
    AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
    ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
  }

  const conflicting = await prisma.appointment.findFirst({
    where,
    select: APPOINTMENT_SELECT,
  })

  if (conflicting) {
    return { hasConflict: true, conflictingAppointment: conflicting as SafeAppointment }
  }

  return { hasConflict: false }
}

/**
 * List all appointments for a tenant
 */
export async function listAppointments(
  tenantId: string,
  options?: ListAppointmentsOptions
): Promise<SafeAppointment[]> {
  const { limit = 50, offset = 0, includeInactive = false, doctorId, patientId, status, from, to } = options || {}

  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(doctorId && { doctorId }),
    ...(patientId && { patientId }),
    ...(status && { status }),
    ...(from || to
      ? {
          startTime: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }
      : {}),
  }

  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
    take: limit,
    skip: offset,
    orderBy: { startTime: 'asc' },
  })

  return appointments as SafeAppointment[]
}

/**
 * Get appointments for calendar view (optimized for date range queries)
 */
export async function getCalendarAppointments(
  tenantId: string,
  options: CalendarOptions
): Promise<SafeAppointment[]> {
  const { from, to, doctorId, patientId, includeInactive = false } = options

  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(doctorId && { doctorId }),
    ...(patientId && { patientId }),
    // Get appointments that overlap with the date range
    AND: [{ startTime: { lt: to } }, { endTime: { gt: from } }],
  }

  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
    orderBy: { startTime: 'asc' },
  })

  return appointments as SafeAppointment[]
}

/**
 * Get a single appointment by ID
 */
export async function getAppointmentById(
  tenantId: string,
  id: string
): Promise<SafeAppointment | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  if (!appointment || appointment.tenantId !== tenantId) {
    return null
  }

  const allocationMap = await buildPatientAllocationMap(tenantId, appointment.patientId)
  return mergeAllocation(appointment as SafeAppointment, allocationMap)
}

/**
 * Build a map of appointmentId → FifoAllocation for every billable item
 * the patient has, computed against their total active payments. Used by
 * endpoints that need to expose paidAmount/outstanding per appointment.
 */
async function buildPatientAllocationMap(
  tenantId: string,
  patientId: string
): Promise<Map<string, { paidAmount: number; outstanding: number; isPaid: boolean }>> {
  const [items, totalPaid] = await Promise.all([
    listBillableItems(tenantId, patientId),
    getTotalPaid(tenantId, patientId),
  ])
  const allocations = computeFifoAllocation(items, totalPaid)
  const map = new Map<string, { paidAmount: number; outstanding: number; isPaid: boolean }>()
  for (const a of allocations) {
    if (a.type === 'appointment') {
      map.set(a.id, { paidAmount: a.paidAmount, outstanding: a.outstanding, isPaid: a.isPaid })
    }
  }
  return map
}

/**
 * Attach paidAmount/outstanding to an appointment using the patient's FIFO
 * allocation map. Also overrides isPaid with the FIFO-derived value so the
 * client always sees a consistent view (the persisted column is a cache
 * that may briefly lag if a write skipped recalc).
 *
 * Appointments not present in the map (cost null/0) get paidAmount=0 and
 * the persisted isPaid is preserved.
 */
function mergeAllocation(
  appointment: SafeAppointment,
  map: Map<string, { paidAmount: number; outstanding: number; isPaid: boolean }>
): SafeAppointment {
  const split = map.get(appointment.id)
  if (!split) {
    return { ...appointment, paidAmount: 0, outstanding: 0 }
  }
  return {
    ...appointment,
    paidAmount: split.paidAmount,
    outstanding: split.outstanding,
    isPaid: split.isPaid,
  }
}

/**
 * Create a new appointment
 */
export async function createAppointment(
  tenantId: string,
  data: CreateAppointmentInput
): Promise<{ appointment?: SafeAppointment; error?: { code: AppointmentErrorCode; message: string } }> {
  // Validate time range
  if (data.startTime >= data.endTime) {
    return {
      error: { code: 'INVALID_TIME_RANGE', message: 'End time must be after start time' },
    }
  }

  // Verify patient belongs to tenant
  const patientValid = await verifyPatientBelongsToTenant(data.patientId, tenantId)
  if (!patientValid) {
    return {
      error: { code: 'INVALID_PATIENT', message: 'Patient not found or does not belong to this clinic' },
    }
  }

  // Verify doctor belongs to tenant
  const doctorValid = await verifyDoctorBelongsToTenant(data.doctorId, tenantId)
  if (!doctorValid) {
    return {
      error: { code: 'INVALID_DOCTOR', message: 'Doctor not found or does not belong to this clinic' },
    }
  }

  // Check for time conflicts
  const conflict = await checkTimeConflict(tenantId, data.doctorId, data.startTime, data.endTime)
  if (conflict.hasConflict) {
    return {
      error: {
        code: 'TIME_CONFLICT',
        message: `Doctor already has an appointment at this time`,
      },
    }
  }

  // Calculate duration if not provided
  const duration = data.duration ?? Math.round((data.endTime.getTime() - data.startTime.getTime()) / 60000)

  const appointment = await prisma.appointment.create({
    data: {
      tenantId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      startTime: data.startTime,
      endTime: data.endTime,
      duration,
      status: data.status ?? 'SCHEDULED',
      type: data.type,
      notes: data.notes,
      privateNotes: data.privateNotes,
      cost: data.cost,
      isPaid: false, // Always false; FIFO payment system is the source of truth
      createdBy: data.createdBy,
    },
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  // Apply the paid transition (creates a capped PatientPayment or just
  // reruns FIFO if existing credit already covers this appointment).
  if (data.isPaid && data.cost && data.cost > 0) {
    const transition = await applyPaidTransition(
      tenantId,
      data.patientId,
      data.cost,
      data.startTime,
      appointment.id
    )
    if (!transition.ok) {
      logger.warn(
        { appointmentId: appointment.id, code: transition.code },
        'Auto-payment failed for appointment marked as paid'
      )
      return { error: { code: transition.code, message: transition.message } }
    }
    const updated = await getAppointmentById(tenantId, appointment.id)
    if (updated) {
      logger.info(`Appointment created with auto-payment: ${appointment.id} for tenant ${tenantId}`)
      return { appointment: updated }
    }
  }

  logger.info(`Appointment created: ${appointment.id} for tenant ${tenantId}`)
  return { appointment: appointment as SafeAppointment }
}

/**
 * Apply the "appointment marked as paid" side effect using FIFO accounting.
 *
 * The intent of the checkbox is "this appointment should end up paid", not
 * "register a payment of exactly `cost`". When the patient already has a
 * credit (overpayment / advance) that fully or partially covers the new
 * debt, sending a payment of `cost` would exceed the outstanding balance
 * and be rejected. Instead we:
 *   - recompute the patient's outstanding balance after the appointment
 *     write (the caller must have already persisted cost/isPaid changes);
 *   - create a payment for `min(cost, outstanding)` only when there is
 *     something left to cover;
 *   - otherwise skip the payment and just rerun FIFO so the existing
 *     credit gets allocated to the new item.
 */
async function applyPaidTransition(
  tenantId: string,
  patientId: string,
  cost: number,
  date: Date,
  appointmentId: string
): Promise<{ ok: true } | { ok: false; code: AppointmentErrorCode; message: string }> {
  const balanceResult = await getPatientBalance(tenantId, patientId)
  if (!balanceResult.success) {
    return {
      ok: false,
      code: mapPaymentErrorCode(balanceResult.code),
      message: paymentErrorMessage(balanceResult.code),
    }
  }

  const outstanding = balanceResult.data.outstanding
  if (outstanding <= 0) {
    // Patient already has enough credit to cover this appointment; just
    // rerun FIFO so isPaid flips for the now-covered items.
    await recalculatePaidStatus(tenantId, patientId)
    return { ok: true }
  }

  const amount = Math.min(cost, outstanding)
  const paymentResult = await createPayment(tenantId, patientId, {
    amount,
    date,
    note: 'Pago en consulta',
    kind: 'APPOINTMENT',
    appointmentId,
  })

  if (!paymentResult.success) {
    return {
      ok: false,
      code: mapPaymentErrorCode(paymentResult.code),
      message: paymentErrorMessage(paymentResult.code),
    }
  }

  return { ok: true }
}

/**
 * Map a payment service error code to an appointment error code.
 */
function mapPaymentErrorCode(code: PaymentErrorCode): AppointmentErrorCode {
  if (code === 'EXCEEDS_BALANCE') return 'EXCEEDS_BALANCE'
  return 'PAYMENT_FAILED'
}

function paymentErrorMessage(code: PaymentErrorCode): string {
  switch (code) {
    case 'EXCEEDS_BALANCE':
      return 'Payment amount exceeds outstanding balance for this patient'
    case 'PATIENT_NOT_FOUND':
      return 'Patient not found'
    case 'NOT_FOUND':
      return 'Payment not found'
    case 'ALREADY_INACTIVE':
      return 'Payment is already inactive'
    default:
      return 'Failed to register payment'
  }
}

/**
 * Update an existing appointment
 */
export async function updateAppointment(
  tenantId: string,
  id: string,
  data: UpdateAppointmentInput
): Promise<{ appointment?: SafeAppointment; error?: { code: AppointmentErrorCode; message: string } }> {
  // Get existing appointment
  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: {
      tenantId: true,
      doctorId: true,
      patientId: true,
      startTime: true,
      endTime: true,
      isPaid: true,
      cost: true,
    },
  })

  if (!existing || existing.tenantId !== tenantId) {
    return { error: { code: 'NOT_FOUND', message: 'Appointment not found' } }
  }

  // Validate time range if both provided
  const newStartTime = data.startTime ?? existing.startTime
  const newEndTime = data.endTime ?? existing.endTime
  if (newStartTime >= newEndTime) {
    return {
      error: { code: 'INVALID_TIME_RANGE', message: 'End time must be after start time' },
    }
  }

  // Verify patient if changing
  if (data.patientId) {
    const patientValid = await verifyPatientBelongsToTenant(data.patientId, tenantId)
    if (!patientValid) {
      return {
        error: { code: 'INVALID_PATIENT', message: 'Patient not found or does not belong to this clinic' },
      }
    }
  }

  // Verify doctor if changing
  const doctorId = data.doctorId ?? existing.doctorId
  if (data.doctorId) {
    const doctorValid = await verifyDoctorBelongsToTenant(data.doctorId, tenantId)
    if (!doctorValid) {
      return {
        error: { code: 'INVALID_DOCTOR', message: 'Doctor not found or does not belong to this clinic' },
      }
    }
  }

  // Check for time conflicts if time or doctor changed
  if (data.startTime || data.endTime || data.doctorId) {
    const conflict = await checkTimeConflict(tenantId, doctorId, newStartTime, newEndTime, id)
    if (conflict.hasConflict) {
      return {
        error: {
          code: 'TIME_CONFLICT',
          message: 'Doctor already has an appointment at this time',
        },
      }
    }
  }

  // Build update data, handling null values properly
  const updateData: Prisma.AppointmentUpdateInput = {}

  if (data.patientId !== undefined) updateData.patient = { connect: { id: data.patientId } }
  if (data.doctorId !== undefined) updateData.doctor = { connect: { id: data.doctorId } }
  if (data.startTime !== undefined) updateData.startTime = data.startTime
  if (data.endTime !== undefined) updateData.endTime = data.endTime
  if (data.duration !== undefined) updateData.duration = data.duration
  if (data.status !== undefined) updateData.status = data.status
  if (data.type !== undefined) updateData.type = data.type
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.privateNotes !== undefined) updateData.privateNotes = data.privateNotes
  if (data.cost !== undefined) updateData.cost = data.cost
  // isPaid is not directly writable; it is derived from PatientPayment records via FIFO.
  // Marking the checkbox in the UI triggers an auto-payment below.

  // Reject explicit attempts to revert isPaid via this endpoint.
  // FIFO has no 1:1 mapping between payment and item, so the user must delete
  // the corresponding PatientPayment record to reverse a payment.
  if (data.isPaid === false && existing.isPaid) {
    return {
      error: {
        code: 'CANNOT_UNMARK_PAID',
        message: 'Cannot revert paid status from this endpoint. Delete the corresponding payment record instead.',
      },
    }
  }

  // Recalculate duration if time changed
  if ((data.startTime || data.endTime) && data.duration === undefined) {
    updateData.duration = Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000)
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: updateData,
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  // Resolve effective post-update cost (numeric) and patient.
  const newCostNumber =
    data.cost === null
      ? null
      : data.cost !== undefined
        ? data.cost
        : existing.cost?.toNumber() ?? null
  const patientId = data.patientId ?? existing.patientId
  const costChanged =
    data.cost !== undefined &&
    (existing.cost?.toNumber() ?? null) !== (data.cost ?? null)

  // Auto-apply paid transition when going from unpaid to paid.
  if (data.isPaid === true && !existing.isPaid && newCostNumber && newCostNumber > 0) {
    const transition = await applyPaidTransition(
      tenantId,
      patientId,
      newCostNumber,
      data.startTime ?? existing.startTime,
      id
    )

    if (!transition.ok) {
      logger.warn(
        { appointmentId: id, code: transition.code },
        'Auto-payment on update failed'
      )
      return { error: { code: transition.code, message: transition.message } }
    }

    const updated = await getAppointmentById(tenantId, id)
    if (updated) {
      logger.info(`Appointment updated with auto-payment: ${id}`)
      return { appointment: updated }
    }
  } else if (costChanged) {
    // Cost changed without an isPaid transition: re-run FIFO so derived
    // isPaid stays consistent with the new debt total.
    await recalculatePaidStatus(tenantId, patientId)
    const updated = await getAppointmentById(tenantId, id)
    if (updated) {
      logger.info(`Appointment cost updated; FIFO recalculated: ${id}`)
      return { appointment: updated }
    }
  }

  logger.info(`Appointment updated: ${id}`)
  return { appointment: appointment as SafeAppointment }
}

/**
 * Soft delete an appointment
 */
export async function deleteAppointment(
  tenantId: string,
  id: string
): Promise<{ appointment?: SafeAppointment; error?: { code: AppointmentErrorCode; message: string } }> {
  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: { tenantId: true, isActive: true },
  })

  if (!existing || existing.tenantId !== tenantId) {
    return { error: { code: 'NOT_FOUND', message: 'Appointment not found' } }
  }

  if (!existing.isActive) {
    return { error: { code: 'ALREADY_INACTIVE', message: 'Appointment is already deleted' } }
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: { isActive: false, status: 'CANCELLED' },
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  logger.info(`Appointment soft-deleted: ${id}`)
  return { appointment: appointment as SafeAppointment }
}

/**
 * Restore a soft-deleted appointment
 */
export async function restoreAppointment(
  tenantId: string,
  id: string
): Promise<{ appointment?: SafeAppointment; error?: { code: AppointmentErrorCode; message: string } }> {
  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: { tenantId: true, isActive: true, doctorId: true, startTime: true, endTime: true },
  })

  if (!existing || existing.tenantId !== tenantId) {
    return { error: { code: 'NOT_FOUND', message: 'Appointment not found' } }
  }

  if (existing.isActive) {
    return { error: { code: 'ALREADY_ACTIVE', message: 'Appointment is already active' } }
  }

  // Check for time conflicts before restoring
  const conflict = await checkTimeConflict(tenantId, existing.doctorId, existing.startTime, existing.endTime, id)
  if (conflict.hasConflict) {
    return {
      error: {
        code: 'TIME_CONFLICT',
        message: 'Cannot restore: Doctor already has an appointment at this time',
      },
    }
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: { isActive: true, status: 'SCHEDULED' },
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  logger.info(`Appointment restored: ${id}`)
  return { appointment: appointment as SafeAppointment }
}

/**
 * Mark an appointment as completed
 */
export async function markAppointmentDone(
  tenantId: string,
  id: string,
  notes?: string
): Promise<{ appointment?: SafeAppointment; error?: { code: AppointmentErrorCode; message: string } }> {
  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: { tenantId: true, isActive: true, status: true },
  })

  if (!existing || existing.tenantId !== tenantId) {
    return { error: { code: 'NOT_FOUND', message: 'Appointment not found' } }
  }

  if (!existing.isActive) {
    return { error: { code: 'ALREADY_INACTIVE', message: 'Cannot complete a deleted appointment' } }
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      ...(notes && { notes }),
    },
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
  })

  logger.info(`Appointment marked as done: ${id}`)
  return { appointment: appointment as SafeAppointment }
}

/**
 * Get appointment statistics for a tenant
 */
export async function getAppointmentStats(
  tenantId: string,
  options?: { from?: Date; to?: Date; doctorId?: string }
): Promise<{
  total: number
  scheduled: number
  completed: number
  cancelled: number
  noShow: number
  todayCount: number
  weekCount: number
  revenue: number
  pendingPayment: number
}> {
  const { from, to, doctorId } = options || {}

  const baseWhere: Prisma.AppointmentWhereInput = {
    tenantId,
    isActive: true,
    ...(doctorId && { doctorId }),
    ...(from && { startTime: { gte: from } }),
    ...(to && { startTime: { lte: to } }),
  }

  // Get counts by status
  const [total, scheduled, completed, cancelled, noShow] = await Promise.all([
    prisma.appointment.count({ where: baseWhere }),
    prisma.appointment.count({ where: { ...baseWhere, status: 'SCHEDULED' } }),
    prisma.appointment.count({ where: { ...baseWhere, status: 'COMPLETED' } }),
    prisma.appointment.count({ where: { ...baseWhere, status: 'CANCELLED' } }),
    prisma.appointment.count({ where: { ...baseWhere, status: 'NO_SHOW' } }),
  ])

  // Today and week counts
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 24 * 60 * 60 * 1000)
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [todayCount, weekCount] = await Promise.all([
    prisma.appointment.count({
      where: {
        tenantId,
        isActive: true,
        ...(doctorId && { doctorId }),
        startTime: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        tenantId,
        isActive: true,
        ...(doctorId && { doctorId }),
        startTime: { gte: weekStart, lt: weekEnd },
      },
    }),
  ])

  // Revenue calculations
  const revenueResult = await prisma.appointment.aggregate({
    where: { ...baseWhere, isPaid: true, cost: { not: null } },
    _sum: { cost: true },
  })

  const pendingResult = await prisma.appointment.aggregate({
    where: { ...baseWhere, isPaid: false, cost: { not: null }, status: 'COMPLETED' },
    _sum: { cost: true },
  })

  return {
    total,
    scheduled,
    completed,
    cancelled,
    noShow,
    todayCount,
    weekCount,
    revenue: revenueResult._sum.cost?.toNumber() ?? 0,
    pendingPayment: pendingResult._sum.cost?.toNumber() ?? 0,
  }
}

/**
 * Get appointments by doctor
 */
export async function getAppointmentsByDoctor(
  tenantId: string,
  doctorId: string,
  options?: { from?: Date; to?: Date; limit?: number; includeInactive?: boolean }
): Promise<SafeAppointment[]> {
  const { from, to, limit = 50, includeInactive = false } = options || {}

  // Verify doctor belongs to tenant
  const doctorValid = await verifyDoctorBelongsToTenant(doctorId, tenantId)
  if (!doctorValid) {
    return []
  }

  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    doctorId,
    ...(includeInactive ? {} : { isActive: true }),
    ...(from || to
      ? {
          startTime: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }
      : {}),
  }

  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
    take: limit,
    orderBy: { startTime: 'asc' },
  })

  return appointments as SafeAppointment[]
}

/**
 * Get appointments by patient
 */
export async function getAppointmentsByPatient(
  tenantId: string,
  patientId: string,
  options?: { limit?: number; includeInactive?: boolean }
): Promise<SafeAppointment[]> {
  const { limit = 50, includeInactive = false } = options || {}

  // Verify patient belongs to tenant
  const patientValid = await verifyPatientBelongsToTenant(patientId, tenantId)
  if (!patientValid) {
    return []
  }

  const where: Prisma.AppointmentWhereInput = {
    tenantId,
    patientId,
    ...(includeInactive ? {} : { isActive: true }),
  }

  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      ...APPOINTMENT_SELECT,
      patient: { select: PATIENT_INCLUDE },
      doctor: { select: DOCTOR_INCLUDE },
    },
    take: limit,
    orderBy: { startTime: 'desc' },
  })

  const allocationMap = await buildPatientAllocationMap(tenantId, patientId)
  return (appointments as SafeAppointment[]).map((a) => mergeAllocation(a, allocationMap))
}
