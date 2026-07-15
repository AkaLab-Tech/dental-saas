import { apiClient } from './api'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract filename from Content-Disposition header
 */
function extractFilename(contentDisposition: string | undefined, defaultFilename: string): string {
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/)
    if (match) {
      return match[1]
    }
  }
  return defaultFilename
}

/**
 * Trigger browser download for a blob
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Generic PDF download function
 */
async function downloadPdf(endpoint: string, defaultFilename: string): Promise<void> {
  const response = await apiClient.get(endpoint, {
    responseType: 'blob',
  })

  const blob = new Blob([response.data], { type: 'application/pdf' })
  const filename = extractFilename(response.headers['content-disposition'], defaultFilename)

  triggerBlobDownload(blob, filename)
}

// ============================================================================
// PDF Download Functions
// ============================================================================

/**
 * Download appointment receipt as PDF
 */
export async function downloadAppointmentPdf(appointmentId: string): Promise<void> {
  await downloadPdf(
    `/appointments/${appointmentId}/pdf`,
    `appointment-receipt-${appointmentId}.pdf`
  )
}

/**
 * Download patient history as PDF
 */
export async function downloadPatientHistoryPdf(patientId: string): Promise<void> {
  await downloadPdf(
    `/patients/${patientId}/history-pdf`,
    `patient-history-${patientId}.pdf`
  )
}

/**
 * Download a budget as PDF
 */
export async function downloadBudgetPdf(budgetId: string): Promise<void> {
  await downloadPdf(`/budgets/${budgetId}/pdf`, `budget-${budgetId}.pdf`)
}

/**
 * Download a labwork order as PDF
 */
export async function downloadLabworkPdf(labworkId: string): Promise<void> {
  await downloadPdf(`/labworks/${labworkId}/pdf`, `labwork-${labworkId}.pdf`)
}
