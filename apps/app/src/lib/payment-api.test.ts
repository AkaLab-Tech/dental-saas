import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getPatientBalance,
  getPatientPayments,
  createPayment,
  deletePayment,
  getDebtors,
  type Payment,
  type PatientBalance,
  type Debtor,
} from './payment-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockPayment: Payment = {
  id: 'payment-123',
  tenantId: 'tenant-456',
  patientId: 'patient-789',
  amount: 150.0,
  date: '2026-02-15',
  note: 'Partial cash payment',
  createdBy: 'user-1',
  isActive: true,
  kind: 'ADVANCE',
  appointmentId: null,
  createdAt: '2026-02-15T00:00:00Z',
  updatedAt: '2026-02-15T00:00:00Z',
}

const mockBalance: PatientBalance = {
  totalDebt: 500,
  totalPaid: 150,
  outstanding: 350,
  credit: 0,
}

const mockPagination = {
  total: 3,
  limit: 50,
  offset: 0,
}

describe('payment-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getPatientBalance', () => {
    it('should fetch patient balance', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockBalance },
      })

      const result = await getPatientBalance('patient-789')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-789/balance')
      expect(result).toEqual(mockBalance)
    })
  })

  describe('getPatientPayments', () => {
    it('should fetch payments without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPayment], pagination: mockPagination },
      })

      const result = await getPatientPayments('patient-789')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-789/payments')
      expect(result.data).toEqual([mockPayment])
      expect(result.pagination).toEqual(mockPagination)
    })

    it('should fetch payments with limit and offset', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPayment], pagination: mockPagination },
      })

      await getPatientPayments('patient-789', { limit: 10, offset: 20 })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients/patient-789/payments?limit=10&offset=20'
      )
    })

    it('should fetch payments with only limit', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: mockPagination },
      })

      await getPatientPayments('patient-789', { limit: 5 })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients/patient-789/payments?limit=5'
      )
    })

    it('should forward the kind filter on the query string when passed', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPayment], pagination: mockPagination },
      })

      await getPatientPayments('patient-789', { kind: 'ADVANCE' })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients/patient-789/payments?kind=ADVANCE'
      )
    })

    it('should combine kind with limit and offset on the query string', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPayment], pagination: mockPagination },
      })

      await getPatientPayments('patient-789', { limit: 50, offset: 0, kind: 'APPOINTMENT' })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients/patient-789/payments?limit=50&kind=APPOINTMENT'
      )
    })

    it('should omit the kind param entirely when not passed', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: mockPagination },
      })

      await getPatientPayments('patient-789', {})

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-789/payments')
    })
  })

  describe('createPayment', () => {
    it('should create a payment with all fields', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockPayment },
      })

      const data = { amount: 150, date: '2026-02-15', note: 'Partial cash payment' }
      const result = await createPayment('patient-789', data)

      expect(apiClient.post).toHaveBeenCalledWith('/patients/patient-789/payments', data)
      expect(result).toEqual(mockPayment)
    })

    it('should create a payment without note', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: { ...mockPayment, note: null } },
      })

      const data = { amount: 100, date: '2026-02-15' }
      const result = await createPayment('patient-789', data)

      expect(apiClient.post).toHaveBeenCalledWith('/patients/patient-789/payments', data)
      expect(result.note).toBeNull()
    })
  })

  describe('deletePayment', () => {
    it('should delete a payment', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true } })

      await deletePayment('patient-789', 'payment-123')

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/patients/patient-789/payments/payment-123'
      )
    })
  })

  describe('getDebtors', () => {
    it('should fetch the list of debtors', async () => {
      const mockDebtors: Debtor[] = [
        { patientId: 'patient-1', name: 'Jane Doe', totalDebt: 500, totalPaid: 100, outstanding: 400 },
        { patientId: 'patient-2', name: 'John Smith', totalDebt: 200, totalPaid: 200, outstanding: 0 },
      ]
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockDebtors },
      })

      const result = await getDebtors()

      expect(apiClient.get).toHaveBeenCalledWith('/patients/debts')
      expect(result).toEqual(mockDebtors)
    })

    it('should return an empty array when there are no debtors', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getDebtors()

      expect(result).toEqual([])
    })
  })
})
