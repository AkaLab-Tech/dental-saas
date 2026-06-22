import { prisma } from '@dental/database'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface OverviewStats {
  totalPatients: number
  totalDoctors: number
  totalAppointments: number
  appointmentsThisMonth: number
  completedAppointmentsThisMonth: number
  pendingLabworks: number
  unpaidLabworks: number
  monthlyRevenue: number
  pendingPayments: number
}

export interface AppointmentStats {
  total: number
  byStatus: Record<string, number>
  byDay: Array<{ date: string; count: number }>
}

export interface RevenueStats {
  total: number
  paid: number
  pending: number
  byMonth: Array<{ month: string; revenue: number }>
}

export interface PatientsGrowthStats {
  total: number
  thisMonth: number
  lastMonth: number
  growthPercentage: number
  byMonth: Array<{ month: string; count: number }>
}

export interface DoctorPerformanceStats {
  doctorId: string
  doctorName: string
  appointmentsCount: number
  completedCount: number
  revenue: number
  completionRate: number
}

export interface UpcomingAppointment {
  id: string
  patientName: string
  startTime: string
  endTime: string
  type: string | null
  status: string
}

export interface AppointmentTypeCount {
  type: string
  count: number
}

// ============================================================================
// Helper Functions
// ============================================================================

function getMonthStart(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getMonthEnd(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function getLastMonthStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - 1, 1)
}

function getLastMonthEnd(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
}

// ============================================================================
// Stats Service Functions
// ============================================================================

/**
 * Get overview statistics for the dashboard
 */
export async function getOverviewStats(tenantId: string, doctorId?: string): Promise<OverviewStats> {
  logger.debug({ tenantId, doctorId }, 'Fetching overview stats')

  const monthStart = getMonthStart()
  const monthEnd = getMonthEnd()

  // When scoped to a doctor, filter appointments by doctorId
  const appointmentDoctorFilter = doctorId ? { doctorId } : {}

  const [
    totalPatients,
    totalDoctors,
    totalAppointments,
    appointmentsThisMonth,
    completedAppointmentsThisMonth,
    pendingLabworks,
    unpaidLabworks,
    revenueData,
    pendingPaymentsData,
  ] = await Promise.all([
    // Total active patients (for doctor: distinct patients from their appointments)
    doctorId
      ? prisma.appointment.findMany({
          where: { tenantId, isActive: true, doctorId },
          select: { patientId: true },
          distinct: ['patientId'],
        }).then((r) => r.length)
      : prisma.patient.count({
          where: { tenantId, isActive: true },
        }),
    // Total active doctors
    prisma.doctor.count({
      where: { tenantId, isActive: true },
    }),
    // Total appointments (all time)
    prisma.appointment.count({
      where: { tenantId, isActive: true, ...appointmentDoctorFilter },
    }),
    // Appointments this month
    prisma.appointment.count({
      where: {
        tenantId,
        isActive: true,
        ...appointmentDoctorFilter,
        startTime: { gte: monthStart, lte: monthEnd },
      },
    }),
    // Completed appointments this month
    prisma.appointment.count({
      where: {
        tenantId,
        isActive: true,
        status: 'COMPLETED',
        ...appointmentDoctorFilter,
        startTime: { gte: monthStart, lte: monthEnd },
      },
    }),
    // Pending labworks (not delivered)
    prisma.labwork.count({
      where: { tenantId, isDelivered: false },
    }),
    // Unpaid labworks
    prisma.labwork.count({
      where: { tenantId, isPaid: false },
    }),
    // Monthly revenue (paid appointments)
    prisma.appointment.aggregate({
      where: {
        tenantId,
        isActive: true,
        isPaid: true,
        ...appointmentDoctorFilter,
        startTime: { gte: monthStart, lte: monthEnd },
      },
      _sum: { cost: true },
    }),
    // Pending payments (unpaid appointments)
    prisma.appointment.aggregate({
      where: {
        tenantId,
        isActive: true,
        isPaid: false,
        status: 'COMPLETED',
        ...appointmentDoctorFilter,
      },
      _sum: { cost: true },
    }),
  ])

  return {
    totalPatients,
    totalDoctors,
    totalAppointments,
    appointmentsThisMonth,
    completedAppointmentsThisMonth,
    pendingLabworks,
    unpaidLabworks,
    monthlyRevenue: revenueData._sum.cost?.toNumber() ?? 0,
    pendingPayments: pendingPaymentsData._sum.cost?.toNumber() ?? 0,
  }
}

/**
 * Get appointment statistics for a given period
 */
export async function getAppointmentStatsForPeriod(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  doctorId?: string
): Promise<AppointmentStats> {
  logger.debug({ tenantId, startDate, endDate, doctorId }, 'Fetching appointment stats')

  // Get appointments in range
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(doctorId ? { doctorId } : {}),
      startTime: { gte: startDate, lte: endDate },
    },
    select: {
      status: true,
      startTime: true,
    },
  })

  // Count by status
  const byStatus: Record<string, number> = {}
  const byDayMap: Record<string, number> = {}

  for (const apt of appointments) {
    // Status count
    byStatus[apt.status] = (byStatus[apt.status] || 0) + 1

    // Day count
    const dayKey = apt.startTime.toISOString().split('T')[0]
    byDayMap[dayKey] = (byDayMap[dayKey] || 0) + 1
  }

  // Convert day map to sorted array
  const byDay = Object.entries(byDayMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    total: appointments.length,
    byStatus,
    byDay,
  }
}

/**
 * Get revenue statistics
 */
export async function getRevenueStats(
  tenantId: string,
  monthsBack: number = 6,
  doctorId?: string
): Promise<RevenueStats> {
  logger.debug({ tenantId, monthsBack, doctorId }, 'Fetching revenue stats')

  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1)

  // Get all completed appointments in range
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      isActive: true,
      status: 'COMPLETED',
      ...(doctorId ? { doctorId } : {}),
      startTime: { gte: startDate },
    },
    select: {
      cost: true,
      isPaid: true,
      startTime: true,
    },
  })

  let total = 0
  let paid = 0
  let pending = 0
  const byMonthMap: Record<string, number> = {}

  for (const apt of appointments) {
    const cost = apt.cost?.toNumber() ?? 0
    total += cost

    if (apt.isPaid) {
      paid += cost
    } else {
      pending += cost
    }

    // Group by month
    const monthKey = `${apt.startTime.getFullYear()}-${String(apt.startTime.getMonth() + 1).padStart(2, '0')}`
    byMonthMap[monthKey] = (byMonthMap[monthKey] || 0) + cost
  }

  const byMonth = Object.entries(byMonthMap)
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    total,
    paid,
    pending,
    byMonth,
  }
}

/**
 * Get patients growth statistics
 */
export async function getPatientsGrowthStats(
  tenantId: string,
  monthsBack: number = 6
): Promise<PatientsGrowthStats> {
  logger.debug({ tenantId, monthsBack }, 'Fetching patients growth stats')

  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1)

  const [totalPatients, patientsThisMonth, patientsLastMonth, patientsByMonth] = await Promise.all([
    // Total active patients
    prisma.patient.count({
      where: { tenantId, isActive: true },
    }),
    // Patients created this month
    prisma.patient.count({
      where: {
        tenantId,
        isActive: true,
        createdAt: { gte: getMonthStart(), lte: getMonthEnd() },
      },
    }),
    // Patients created last month
    prisma.patient.count({
      where: {
        tenantId,
        isActive: true,
        createdAt: { gte: getLastMonthStart(), lte: getLastMonthEnd() },
      },
    }),
    // Patients grouped by creation month
    prisma.patient.findMany({
      where: {
        tenantId,
        isActive: true,
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
      },
    }),
  ])

  // Group by month
  const byMonthMap: Record<string, number> = {}
  for (const patient of patientsByMonth) {
    const monthKey = `${patient.createdAt.getFullYear()}-${String(patient.createdAt.getMonth() + 1).padStart(2, '0')}`
    byMonthMap[monthKey] = (byMonthMap[monthKey] || 0) + 1
  }

  const byMonth = Object.entries(byMonthMap)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // Calculate growth percentage
  let growthPercentage = 0
  if (patientsLastMonth > 0) {
    growthPercentage = ((patientsThisMonth - patientsLastMonth) / patientsLastMonth) * 100
  } else if (patientsThisMonth > 0) {
    growthPercentage = 100
  }

  return {
    total: totalPatients,
    thisMonth: patientsThisMonth,
    lastMonth: patientsLastMonth,
    growthPercentage: Math.round(growthPercentage * 10) / 10,
    byMonth,
  }
}

/**
 * Get doctor performance statistics
 */
export async function getDoctorPerformanceStats(tenantId: string): Promise<DoctorPerformanceStats[]> {
  logger.debug({ tenantId }, 'Fetching doctor performance stats')

  const monthStart = getMonthStart()
  const monthEnd = getMonthEnd()

  // Get all active doctors
  const doctors = await prisma.doctor.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  })

  if (doctors.length === 0) {
    return []
  }

  const doctorIds = doctors.map((doctor) => doctor.id)

  // Get all appointments for all doctors this month in a single query (avoids N+1)
  const allAppointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      doctorId: { in: doctorIds },
      isActive: true,
      startTime: { gte: monthStart, lte: monthEnd },
    },
    select: {
      doctorId: true,
      status: true,
      cost: true,
      isPaid: true,
    },
  })

  // Group appointments by doctorId
  const appointmentsByDoctor = new Map<string, typeof allAppointments>()
  for (const appointment of allAppointments) {
    const existing = appointmentsByDoctor.get(appointment.doctorId) ?? []
    existing.push(appointment)
    appointmentsByDoctor.set(appointment.doctorId, existing)
  }

  const performanceStats: DoctorPerformanceStats[] = []

  for (const doctor of doctors) {
    const appointments = appointmentsByDoctor.get(doctor.id) ?? []

    const appointmentsCount = appointments.length
    const completedCount = appointments.filter((a) => a.status === 'COMPLETED').length
    const revenue = appointments
      .filter((a) => a.status === 'COMPLETED' && a.isPaid)
      .reduce((sum, a) => sum + (a.cost?.toNumber() ?? 0), 0)

    const completionRate = appointmentsCount > 0 ? (completedCount / appointmentsCount) * 100 : 0

    performanceStats.push({
      doctorId: doctor.id,
      doctorName: `${doctor.firstName} ${doctor.lastName}`,
      appointmentsCount,
      completedCount,
      revenue,
      completionRate: Math.round(completionRate * 10) / 10,
    })
  }

  // Sort by appointments count descending
  return performanceStats.sort((a, b) => b.appointmentsCount - a.appointmentsCount)
}

/**
 * Get upcoming appointments for a doctor
 */
export async function getUpcomingAppointments(
  tenantId: string,
  doctorId: string,
  limit: number = 10
): Promise<UpcomingAppointment[]> {
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      doctorId,
      isActive: true,
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
      startTime: { gte: new Date() },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      type: true,
      status: true,
      patient: {
        select: { firstName: true, lastName: true },
      },
    },
    orderBy: { startTime: 'asc' },
    take: limit,
  })

  return appointments.map((a) => ({
    id: a.id,
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    type: a.type,
    status: a.status,
  }))
}

/**
 * Get appointment type distribution for a doctor (current month)
 */
export async function getAppointmentTypeStats(
  tenantId: string,
  doctorId: string
): Promise<AppointmentTypeCount[]> {
  const monthStart = getMonthStart()
  const monthEnd = getMonthEnd()

  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      doctorId,
      isActive: true,
      startTime: { gte: monthStart, lte: monthEnd },
    },
    select: { type: true },
  })

  const countMap: Record<string, number> = {}
  for (const a of appointments) {
    const type = a.type || 'Sin tipo'
    countMap[type] = (countMap[type] || 0) + 1
  }

  return Object.entries(countMap)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
}
