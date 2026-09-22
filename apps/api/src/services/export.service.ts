import { prisma } from '@dental/database'

export interface ExportData {
  exportedAt: string
  tenant: {
    name: string
    slug: string
    email: string | null
    phone: string | null
    address: string | null
    timezone: string
    currency: string
  }
  patients: Array<{
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    dob: string | null
    gender: string | null
    address: string | null
    notes: unknown
    teeth: unknown
    createdAt: string
  }>
  doctors: Array<{
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    specialty: string | null
    licenseNumber: string | null
    workingDays: unknown
    workingHours: unknown
    consultingRoom: string | null
    bio: string | null
    hourlyRate: string | null
    createdAt: string
  }>
  appointments: Array<{
    id: string
    patientId: string
    doctorId: string
    startTime: string
    endTime: string
    duration: number
    status: string
    type: string | null
    notes: string | null
    cost: string | null
    isPaid: boolean
    createdAt: string
  }>
  labworks: Array<{
    id: string
    patientId: string | null
    lab: string
    phoneNumber: string | null
    date: string
    note: string | null
    price: string
    isPaid: boolean
    isDelivered: boolean
    status: string
    doctorIds: unknown
    createdAt: string
  }>
  expenses: Array<{
    id: string
    date: string
    amount: string
    issuer: string | null
    phoneNumber: string | null
    note: string | null
    createdAt: string
  }>
}

export const ExportService = {
  /**
   * Export all tenant data as a JSON structure
   */
  async exportTenantData(tenantId: string): Promise<ExportData> {
    // Fetch all data in parallel
    const [tenant, patients, doctors, appointments, labworks, expenses] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          slug: true,
          email: true,
          phone: true,
          address: true,
          timezone: true,
          currency: true,
        },
      }),
      prisma.patient.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          dob: true,
          gender: true,
          address: true,
          notes: true,
          teeth: true,
          createdAt: true,
        },
        orderBy: { lastName: 'asc' },
      }),
      prisma.doctor.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          specialty: true,
          licenseNumber: true,
          workingDays: true,
          workingHours: true,
          consultingRoom: true,
          bio: true,
          hourlyRate: true,
          createdAt: true,
        },
        orderBy: { lastName: 'asc' },
      }),
      prisma.appointment.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          patientId: true,
          doctorId: true,
          startTime: true,
          endTime: true,
          duration: true,
          status: true,
          type: true,
          notes: true,
          cost: true,
          isPaid: true,
          createdAt: true,
        },
        orderBy: { startTime: 'desc' },
      }),
      prisma.labwork.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          patientId: true,
          lab: true,
          phoneNumber: true,
          date: true,
          note: true,
          price: true,
          isPaid: true,
          isDelivered: true,
          status: true,
          doctorIds: true,
          createdAt: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.expense.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          date: true,
          amount: true,
          issuer: true,
          phoneNumber: true,
          note: true,
          createdAt: true,
        },
        orderBy: { date: 'desc' },
      }),
    ])

    if (!tenant) {
      throw new Error('Tenant not found')
    }

    return {
      exportedAt: new Date().toISOString(),
      tenant,
      patients: patients.map((p) => ({
        ...p,
        dob: p.dob?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      doctors: doctors.map((d) => ({
        ...d,
        hourlyRate: d.hourlyRate?.toString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      appointments: appointments.map((a) => ({
        ...a,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        cost: a.cost?.toString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      labworks: labworks.map((l) => ({
        ...l,
        date: l.date.toISOString(),
        price: l.price.toString(),
        createdAt: l.createdAt.toISOString(),
      })),
      expenses: expenses.map((e) => ({
        ...e,
        date: e.date.toISOString(),
        amount: e.amount.toString(),
        createdAt: e.createdAt.toISOString(),
      })),
    }
  },
}
