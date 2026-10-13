import { apiClient } from './api'
import type { MedicalHistory } from '@dental/shared'

interface ApiResponse<T> {
  success: boolean
  data: T
}

/** A partial write: sections that are omitted are left untouched by the API. */
export type MedicalHistoryUpdate = Partial<MedicalHistory>

export async function getMedicalHistory(patientId: string): Promise<MedicalHistory> {
  const response = await apiClient.get<ApiResponse<MedicalHistory>>(
    `/patients/${patientId}/medical-history`
  )
  return response.data.data
}

export async function updateMedicalHistory(
  patientId: string,
  data: MedicalHistoryUpdate
): Promise<MedicalHistory> {
  const response = await apiClient.put<ApiResponse<MedicalHistory>>(
    `/patients/${patientId}/medical-history`,
    data
  )
  return response.data.data
}
