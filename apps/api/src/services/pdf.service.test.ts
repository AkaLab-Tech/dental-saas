import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { Document, Page, Text } from '@react-pdf/renderer'
import { PdfService } from './pdf.service.js'
import { prisma } from '@dental/database'
import type {
  AppointmentReceiptData,
  PatientHistoryData,
  TenantInfo,
  PatientInfo,
  DoctorInfo,
  AppointmentInfo,
  AppointmentSummary,
} from './pdf.service.js'

// Mock prisma to avoid database dependency
vi.mock('@dental/database', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    patient: {
      findFirst: vi.fn(),
    },
    budget: {
      findFirst: vi.fn(),
    },
    labwork: {
      findFirst: vi.fn(),
    },
    doctor: {
      findMany: vi.fn(),
    },
  },
  AppointmentStatus: {
    SCHEDULED: 'SCHEDULED',
    CONFIRMED: 'CONFIRMED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    NO_SHOW: 'NO_SHOW',
    RESCHEDULED: 'RESCHEDULED',
  },
}))

// Helper to create mock data
function createMockTenantInfo(overrides: Partial<TenantInfo> = {}): TenantInfo {
  return {
    name: 'Test Clinic',
    email: 'clinic@test.com',
    phone: '+1234567890',
    address: '123 Test Street',
    logo: null,
    timezone: 'America/New_York',
    currency: 'USD',
    language: 'en',
    ...overrides,
  }
}

function createMockPatientInfo(overrides: Partial<PatientInfo> = {}): PatientInfo {
  return {
    id: 'patient-123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@test.com',
    phone: '+1234567890',
    dob: new Date('1990-01-15'),
    gender: 'Male',
    address: '456 Patient Lane',
    ...overrides,
  }
}

function createMockDoctorInfo(overrides: Partial<DoctorInfo> = {}): DoctorInfo {
  return {
    id: 'doctor-123',
    firstName: 'Jane',
    lastName: 'Smith',
    specialty: 'General Dentistry',
    licenseNumber: 'DDS-12345',
    ...overrides,
  }
}

function createMockAppointmentInfo(overrides: Partial<AppointmentInfo> = {}): AppointmentInfo {
  return {
    id: 'appointment-123',
    startTime: new Date('2026-01-20T10:00:00Z'),
    endTime: new Date('2026-01-20T10:30:00Z'),
    duration: 30,
    status: 'COMPLETED' as const,
    type: 'Checkup',
    notes: 'Regular dental checkup. All teeth healthy.',
    cost: '150.00',
    isPaid: true,
    ...overrides,
  }
}

function createMockAppointmentSummary(overrides: Partial<AppointmentSummary> = {}): AppointmentSummary {
  return {
    id: 'appointment-123',
    date: new Date('2026-01-20T10:00:00Z'),
    type: 'Checkup',
    status: 'COMPLETED' as const,
    doctorName: 'Dr. Jane Smith',
    notes: 'Regular checkup',
    cost: '150.00',
    isPaid: true,
    ...overrides,
  }
}

function createMockAppointmentReceiptData(
  overrides: Partial<AppointmentReceiptData> = {}
): AppointmentReceiptData {
  return {
    tenant: createMockTenantInfo(),
    patient: createMockPatientInfo(),
    doctor: createMockDoctorInfo(),
    appointment: createMockAppointmentInfo(),
    generatedAt: new Date('2026-01-20T12:00:00Z'),
    ...overrides,
  }
}

function createMockPatientHistoryData(
  overrides: Partial<PatientHistoryData> = {}
): PatientHistoryData {
  return {
    tenant: createMockTenantInfo(),
    patient: createMockPatientInfo(),
    appointments: [
      createMockAppointmentSummary(),
      createMockAppointmentSummary({
        id: 'appointment-456',
        date: new Date('2026-01-10T14:00:00Z'),
        type: 'Cleaning',
        cost: '100.00',
      }),
    ],
    teethNotes: {
      '11': 'Healthy',
      '21': 'Small cavity - monitor',
      '36': 'Filling done 2025',
    },
    generatedAt: new Date('2026-01-20T12:00:00Z'),
    ...overrides,
  }
}

// Simple test document for PDF generation
function SimpleTestDocument() {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4' },
      React.createElement(Text, null, 'Test PDF Document')
    )
  )
}

describe('PdfService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generatePdf', () => {
    it('should generate a PDF buffer from a React PDF document', async () => {
      const document = SimpleTestDocument()
      const buffer = await PdfService.generatePdf(document)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(0)
      // PDF files start with %PDF-
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-')
    })

    it('should generate valid PDF with correct header', async () => {
      const document = SimpleTestDocument()
      const buffer = await PdfService.generatePdf(document)

      // Check PDF header
      const header = buffer.toString('utf8', 0, 8)
      expect(header).toMatch(/^%PDF-\d\.\d/)
    })

    it('should handle complex documents', async () => {
      // Create a more complex document
      const complexDocument = React.createElement(
        Document,
        null,
        React.createElement(
          Page,
          { size: 'A4' },
          React.createElement(Text, null, 'Title'),
          React.createElement(Text, null, 'Paragraph 1'),
          React.createElement(Text, null, 'Paragraph 2')
        )
      )

      const buffer = await PdfService.generatePdf(complexDocument)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(0)
    })
  })

  describe('Data types', () => {
    it('should create valid TenantInfo', () => {
      const tenant = createMockTenantInfo()

      expect(tenant.name).toBe('Test Clinic')
      expect(tenant.timezone).toBe('America/New_York')
      expect(tenant.currency).toBe('USD')
    })

    it('should create valid PatientInfo with all fields', () => {
      const patient = createMockPatientInfo()

      expect(patient.firstName).toBe('John')
      expect(patient.lastName).toBe('Doe')
      expect(patient.dob).toBeInstanceOf(Date)
    })

    it('should create valid PatientInfo with null optional fields', () => {
      const patient = createMockPatientInfo({
        email: null,
        phone: null,
        dob: null,
        gender: null,
        address: null,
      })

      expect(patient.email).toBeNull()
      expect(patient.phone).toBeNull()
      expect(patient.dob).toBeNull()
    })

    it('should create valid DoctorInfo', () => {
      const doctor = createMockDoctorInfo()

      expect(doctor.firstName).toBe('Jane')
      expect(doctor.specialty).toBe('General Dentistry')
      expect(doctor.licenseNumber).toBe('DDS-12345')
    })

    it('should create valid AppointmentInfo', () => {
      const appointment = createMockAppointmentInfo()

      expect(appointment.status).toBe('COMPLETED')
      expect(appointment.duration).toBe(30)
      expect(appointment.isPaid).toBe(true)
    })

    it('should create valid AppointmentReceiptData', () => {
      const data = createMockAppointmentReceiptData()

      expect(data.tenant.name).toBe('Test Clinic')
      expect(data.patient.firstName).toBe('John')
      expect(data.doctor.firstName).toBe('Jane')
      expect(data.appointment.status).toBe('COMPLETED')
      expect(data.generatedAt).toBeInstanceOf(Date)
    })

    it('should create valid PatientHistoryData', () => {
      const data = createMockPatientHistoryData()

      expect(data.appointments).toHaveLength(2)
      expect(data.teethNotes).toHaveProperty('11')
      expect(data.teethNotes?.['21']).toBe('Small cavity - monitor')
    })

    it('should handle PatientHistoryData with no teeth notes', () => {
      const data = createMockPatientHistoryData({
        teethNotes: null,
      })

      expect(data.teethNotes).toBeNull()
    })

    it('should handle PatientHistoryData with empty appointments', () => {
      const data = createMockPatientHistoryData({
        appointments: [],
      })

      expect(data.appointments).toHaveLength(0)
    })
  })

  describe('AppointmentReceiptData validation', () => {
    it('should handle unpaid appointment', () => {
      const data = createMockAppointmentReceiptData({
        appointment: createMockAppointmentInfo({
          isPaid: false,
          cost: '200.00',
        }),
      })

      expect(data.appointment.isPaid).toBe(false)
      expect(data.appointment.cost).toBe('200.00')
    })

    it('should handle appointment with no cost', () => {
      const data = createMockAppointmentReceiptData({
        appointment: createMockAppointmentInfo({
          cost: null,
        }),
      })

      expect(data.appointment.cost).toBeNull()
    })

    it('should handle appointment with no notes', () => {
      const data = createMockAppointmentReceiptData({
        appointment: createMockAppointmentInfo({
          notes: null,
          type: null,
        }),
      })

      expect(data.appointment.notes).toBeNull()
      expect(data.appointment.type).toBeNull()
    })

    it('should handle different appointment statuses', () => {
      const statuses = [
        'SCHEDULED',
        'CONFIRMED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
        'RESCHEDULED',
      ] as const

      statuses.forEach((status) => {
        const data = createMockAppointmentReceiptData({
          appointment: createMockAppointmentInfo({ status }),
        })
        expect(data.appointment.status).toBe(status)
      })
    })
  })

  describe('PatientHistoryData validation', () => {
    it('should handle patient with many appointments', () => {
      const appointments = Array.from({ length: 50 }, (_, i) =>
        createMockAppointmentSummary({
          id: `appointment-${i}`,
          date: new Date(2026, 0, (i % 28) + 1, 10, 0, 0),
        })
      )

      const data = createMockPatientHistoryData({ appointments })

      expect(data.appointments).toHaveLength(50)
    })

    it('should handle teeth notes with various tooth numbers', () => {
      const teethNotes: Record<string, string> = {}
      // Upper teeth: 11-18, 21-28
      // Lower teeth: 31-38, 41-48
      const toothNumbers = ['11', '12', '21', '31', '41', '18', '28', '38', '48']
      toothNumbers.forEach((num) => {
        teethNotes[num] = `Note for tooth ${num}`
      })

      const data = createMockPatientHistoryData({ teethNotes })

      expect(Object.keys(data.teethNotes || {})).toHaveLength(9)
      expect(data.teethNotes?.['11']).toBe('Note for tooth 11')
    })

    it('should handle different currencies', () => {
      const currencies = ['USD', 'EUR', 'GBP', 'MXN', 'ARS']

      currencies.forEach((currency) => {
        const data = createMockPatientHistoryData({
          tenant: createMockTenantInfo({ currency }),
        })
        expect(data.tenant.currency).toBe(currency)
      })
    })

    it('should handle different timezones', () => {
      const timezones = [
        'America/New_York',
        'America/Los_Angeles',
        'Europe/London',
        'Asia/Tokyo',
        'UTC',
      ]

      timezones.forEach((timezone) => {
        const data = createMockPatientHistoryData({
          tenant: createMockTenantInfo({ timezone }),
        })
        expect(data.tenant.timezone).toBe(timezone)
      })
    })
  })

  describe('getBudgetPdfData', () => {
    function mockBudgetRow() {
      return {
        id: 'budget-123',
        tenantId: 'tenant-123',
        patientId: 'patient-123',
        createdById: null,
        status: 'APPROVED' as const,
        notes: 'Full treatment plan',
        validUntil: new Date('2027-01-01T00:00:00Z'),
        totalAmount: { toString: () => '380.00' },
        publicToken: null,
        publicTokenExpiresAt: null,
        isActive: true,
        createdAt: new Date('2026-01-20T10:00:00Z'),
        updatedAt: new Date('2026-01-20T10:00:00Z'),
        items: [
          {
            id: 'item-1',
            budgetId: 'budget-123',
            description: 'Cleaning',
            toothNumber: null,
            quantity: 1,
            unitPrice: { toString: () => '80.00' },
            totalPrice: { toString: () => '80.00' },
            plannedAppointmentType: null,
            status: 'PENDING' as const,
            notes: null,
            order: 0,
            createdAt: new Date('2026-01-20T10:00:00Z'),
            updatedAt: new Date('2026-01-20T10:00:00Z'),
          },
          {
            id: 'item-2',
            budgetId: 'budget-123',
            description: 'Filling 16',
            toothNumber: '16',
            quantity: 2,
            unitPrice: { toString: () => '150.00' },
            totalPrice: { toString: () => '300.00' },
            plannedAppointmentType: null,
            status: 'EXECUTED' as const,
            notes: null,
            order: 1,
            createdAt: new Date('2026-01-20T10:00:00Z'),
            updatedAt: new Date('2026-01-20T10:00:00Z'),
          },
        ],
      }
    }

    it('assembles tenant, patient, and budget (with formatted amounts) on the happy path', async () => {
      vi.mocked(prisma.budget.findFirst).mockResolvedValue(
        mockBudgetRow() as unknown as Awaited<ReturnType<typeof prisma.budget.findFirst>>
      )
      vi.mocked(prisma.patient.findFirst).mockResolvedValue(
        createMockPatientInfo() as unknown as Awaited<ReturnType<typeof prisma.patient.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        name: 'Test Clinic',
        email: 'clinic@test.com',
        phone: '+1234567890',
        address: '123 Test Street',
        logo: null,
        timezone: 'America/New_York',
        currency: 'USD',
        settings: { language: 'en' },
      } as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>)

      const result = await PdfService.getBudgetPdfData('tenant-123', 'budget-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.patient.firstName).toBe('John')
      expect(result.data.tenant.name).toBe('Test Clinic')
      expect(result.data.budget.id).toBe('budget-123')
      expect(result.data.budget.status).toBe('APPROVED')
      expect(result.data.budget.totalAmount).toBe('380.00')
      expect(result.data.budget.items).toHaveLength(2)
      expect(result.data.budget.items[0]).toMatchObject({
        id: 'item-1',
        description: 'Cleaning',
        toothNumber: null,
        quantity: 1,
        unitPrice: '80.00',
        totalPrice: '80.00',
        status: 'PENDING',
      })
      expect(result.data.budget.items[1]).toMatchObject({
        id: 'item-2',
        description: 'Filling 16',
        toothNumber: '16',
        quantity: 2,
        unitPrice: '150.00',
        totalPrice: '300.00',
        status: 'EXECUTED',
      })
      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: { id: 'patient-123', tenantId: 'tenant-123' },
        select: expect.any(Object),
      })
    })

    it('returns NOT_FOUND when the budget does not exist for the tenant', async () => {
      vi.mocked(prisma.budget.findFirst).mockResolvedValue(null)

      const result = await PdfService.getBudgetPdfData('tenant-123', 'missing-budget')

      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Budget not found' })
      expect(prisma.patient.findFirst).not.toHaveBeenCalled()
    })

    it('returns NOT_FOUND when the budget resolves but the patient record is missing', async () => {
      vi.mocked(prisma.budget.findFirst).mockResolvedValue(
        mockBudgetRow() as unknown as Awaited<ReturnType<typeof prisma.budget.findFirst>>
      )
      vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)

      const result = await PdfService.getBudgetPdfData('tenant-123', 'budget-123')

      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Patient not found' })
    })

    it('returns INVALID_TENANT when the tenant lookup fails after budget/patient resolve', async () => {
      vi.mocked(prisma.budget.findFirst).mockResolvedValue(
        mockBudgetRow() as unknown as Awaited<ReturnType<typeof prisma.budget.findFirst>>
      )
      vi.mocked(prisma.patient.findFirst).mockResolvedValue(
        createMockPatientInfo() as unknown as Awaited<ReturnType<typeof prisma.patient.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null)

      const result = await PdfService.getBudgetPdfData('tenant-123', 'budget-123')

      expect(result).toEqual({ error: 'INVALID_TENANT', message: 'Tenant not found' })
    })

    it('handles a budget with no items', async () => {
      const row = mockBudgetRow()
      row.items = []
      vi.mocked(prisma.budget.findFirst).mockResolvedValue(
        row as unknown as Awaited<ReturnType<typeof prisma.budget.findFirst>>
      )
      vi.mocked(prisma.patient.findFirst).mockResolvedValue(
        createMockPatientInfo() as unknown as Awaited<ReturnType<typeof prisma.patient.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        name: 'Test Clinic',
        email: null,
        phone: null,
        address: null,
        logo: null,
        timezone: 'UTC',
        currency: 'USD',
        settings: null,
      } as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>)

      const result = await PdfService.getBudgetPdfData('tenant-123', 'budget-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.budget.items).toEqual([])
      // No tenant settings -> falls back to 'es'
      expect(result.data.tenant.language).toBe('es')
    })
  })

  describe('getLabworkOrderData', () => {
    function mockLabworkRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'labwork-123',
        tenantId: 'tenant-123',
        patientId: 'patient-123',
        appointmentId: null,
        priceIncludedInAppointment: false,
        lab: 'Acme Dental Lab',
        phoneNumber: '+1234567890',
        date: new Date('2026-01-20T10:00:00Z'),
        note: 'Rush order',
        price: { toString: () => '250.00' },
        isPaid: false,
        isDelivered: false,
        doctorIds: ['doctor-1', 'doctor-2'],
        isActive: true,
        createdBy: null,
        createdAt: new Date('2026-01-10T10:00:00Z'),
        updatedAt: new Date('2026-01-10T10:00:00Z'),
        patient: {
          id: 'patient-123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
          phone: '+1234567890',
        },
        ...overrides,
      }
    }

    function mockTenantRow(overrides: Record<string, unknown> = {}) {
      return {
        name: 'Test Clinic',
        email: 'clinic@test.com',
        phone: '+1234567890',
        address: '123 Test Street',
        logo: null,
        timezone: 'America/New_York',
        currency: 'USD',
        settings: { language: 'en' },
        ...overrides,
      }
    }

    it('assembles tenant, patient and resolved doctor names on the happy path', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(
        mockLabworkRow() as unknown as Awaited<ReturnType<typeof prisma.labwork.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(
        mockTenantRow() as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>
      )
      vi.mocked(prisma.doctor.findMany).mockResolvedValue([
        { id: 'doctor-1', firstName: 'Jane', lastName: 'Smith' },
        { id: 'doctor-2', firstName: 'Bob', lastName: 'Lee' },
      ] as unknown as Awaited<ReturnType<typeof prisma.doctor.findMany>>)

      const result = await PdfService.getLabworkOrderData('tenant-123', 'labwork-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.tenant.name).toBe('Test Clinic')
      expect(result.data.patient).toEqual({ id: 'patient-123', firstName: 'John', lastName: 'Doe' })
      expect(result.data.doctors).toEqual([
        { id: 'doctor-1', firstName: 'Jane', lastName: 'Smith' },
        { id: 'doctor-2', firstName: 'Bob', lastName: 'Lee' },
      ])
      expect(result.data.labwork).toMatchObject({
        id: 'labwork-123',
        lab: 'Acme Dental Lab',
        phoneNumber: '+1234567890',
        note: 'Rush order',
        price: '250.00',
        isPaid: false,
        isDelivered: false,
      })
      expect(prisma.doctor.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['doctor-1', 'doctor-2'] }, tenantId: 'tenant-123' },
        select: { id: true, firstName: true, lastName: true },
      })
    })

    it('returns NOT_FOUND when the labwork does not exist for the tenant', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(null)

      const result = await PdfService.getLabworkOrderData('tenant-123', 'missing-labwork')

      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Labwork not found' })
      expect(prisma.doctor.findMany).not.toHaveBeenCalled()
    })

    it('returns NOT_FOUND when the labwork belongs to another tenant (row scoped by tenantId in the query)', async () => {
      // getLabworkById queries with { id, tenantId } so a cross-tenant row
      // never resolves — prisma returns null exactly as the "missing" case.
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(null)

      const result = await PdfService.getLabworkOrderData('other-tenant', 'labwork-123')

      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Labwork not found' })
    })

    it('returns INVALID_TENANT when the tenant lookup fails after the labwork resolves', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(
        mockLabworkRow() as unknown as Awaited<ReturnType<typeof prisma.labwork.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null)

      const result = await PdfService.getLabworkOrderData('tenant-123', 'labwork-123')

      expect(result).toEqual({ error: 'INVALID_TENANT', message: 'Tenant not found' })
    })

    it('renders blank doctors with no crash when doctorIds point at deleted/missing doctors', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(
        mockLabworkRow({ doctorIds: ['deleted-doctor-1'] }) as unknown as Awaited<
          ReturnType<typeof prisma.labwork.findFirst>
        >
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(
        mockTenantRow() as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>
      )
      // The doctor row was deleted after the labwork was assigned to it.
      vi.mocked(prisma.doctor.findMany).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof prisma.doctor.findMany>>
      )

      const result = await PdfService.getLabworkOrderData('tenant-123', 'labwork-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.doctors).toEqual([])
    })

    it('skips the doctor lookup entirely and returns an empty array when doctorIds is empty', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(
        mockLabworkRow({ doctorIds: [] }) as unknown as Awaited<ReturnType<typeof prisma.labwork.findFirst>>
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(
        mockTenantRow() as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>
      )

      const result = await PdfService.getLabworkOrderData('tenant-123', 'labwork-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.doctors).toEqual([])
      expect(prisma.doctor.findMany).not.toHaveBeenCalled()
    })

    it('returns a null patient when the labwork has no linked patient', async () => {
      vi.mocked(prisma.labwork.findFirst).mockResolvedValue(
        mockLabworkRow({ patientId: null, patient: null, doctorIds: [] }) as unknown as Awaited<
          ReturnType<typeof prisma.labwork.findFirst>
        >
      )
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(
        mockTenantRow() as unknown as Awaited<ReturnType<typeof prisma.tenant.findUnique>>
      )

      const result = await PdfService.getLabworkOrderData('tenant-123', 'labwork-123')

      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(result.data.patient).toBeNull()
    })
  })
})
