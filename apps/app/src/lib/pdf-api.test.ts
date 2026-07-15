import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadAppointmentPdf, downloadPatientHistoryPdf, downloadBudgetPdf, downloadLabworkPdf } from './pdf-api'
import { apiClient } from './api'

// Mock apiClient
vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
const mockRevokeObjectURL = vi.fn()
global.URL.createObjectURL = mockCreateObjectURL
global.URL.revokeObjectURL = mockRevokeObjectURL

describe('pdf-api', () => {
  let mockLink: { href: string; download: string; click: ReturnType<typeof vi.fn> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appendChildSpy: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeChildSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock document.createElement for anchor element
    mockLink = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement)
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as unknown as Node)
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as unknown as Node)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('downloadAppointmentPdf', () => {
    it('should download appointment PDF with correct filename from header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {
          'content-disposition': 'attachment; filename="appointment-receipt-123.pdf"',
        },
      })

      await downloadAppointmentPdf('123')

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/123/pdf', {
        responseType: 'blob',
      })
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockLink.download).toBe('appointment-receipt-123.pdf')
      expect(mockLink.click).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('should use default filename when no Content-Disposition header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadAppointmentPdf('456')

      expect(mockLink.download).toBe('appointment-receipt-456.pdf')
    })

    it('should cleanup resources after download', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadAppointmentPdf('789')

      expect(appendChildSpy).toHaveBeenCalled()
      expect(removeChildSpy).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalled()
    })

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('API Error'))

      await expect(downloadAppointmentPdf('error')).rejects.toThrow('API Error')
    })
  })

  describe('downloadPatientHistoryPdf', () => {
    it('should download patient history PDF with correct filename from header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {
          'content-disposition': 'attachment; filename="patient-history-john-doe-123.pdf"',
        },
      })

      await downloadPatientHistoryPdf('123')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/123/history-pdf', {
        responseType: 'blob',
      })
      expect(mockLink.download).toBe('patient-history-john-doe-123.pdf')
      expect(mockLink.click).toHaveBeenCalled()
    })

    it('should use default filename when no Content-Disposition header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadPatientHistoryPdf('456')

      expect(mockLink.download).toBe('patient-history-456.pdf')
    })

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('API Error'))

      await expect(downloadPatientHistoryPdf('error')).rejects.toThrow('API Error')
    })

    it('should create blob with correct type', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadPatientHistoryPdf('789')

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })
  })

  describe('downloadBudgetPdf', () => {
    it('should download budget PDF with correct filename from header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {
          'content-disposition': 'attachment; filename="budget-123.pdf"',
        },
      })

      await downloadBudgetPdf('123')

      expect(apiClient.get).toHaveBeenCalledWith('/budgets/123/pdf', {
        responseType: 'blob',
      })
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockLink.download).toBe('budget-123.pdf')
      expect(mockLink.click).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('should use default filename when no Content-Disposition header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadBudgetPdf('456')

      expect(mockLink.download).toBe('budget-456.pdf')
    })

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('API Error'))

      await expect(downloadBudgetPdf('error')).rejects.toThrow('API Error')
    })
  })

  describe('downloadLabworkPdf', () => {
    it('should download labwork PDF with correct filename from header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {
          'content-disposition': 'attachment; filename="labwork-123.pdf"',
        },
      })

      await downloadLabworkPdf('123')

      expect(apiClient.get).toHaveBeenCalledWith('/labworks/123/pdf', {
        responseType: 'blob',
      })
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockLink.download).toBe('labwork-123.pdf')
      expect(mockLink.click).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('should use default filename when no Content-Disposition header', async () => {
      const mockBlob = new Blob(['mock pdf'], { type: 'application/pdf' })
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockBlob,
        headers: {},
      })

      await downloadLabworkPdf('456')

      expect(mockLink.download).toBe('labwork-456.pdf')
    })

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('API Error'))

      await expect(downloadLabworkPdf('error')).rejects.toThrow('API Error')
    })
  })
})
