import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MedicalHistory } from '@dental/shared'
import { getMedicalHistory, updateMedicalHistory } from './medical-history-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
}))

const history: MedicalHistory = {
  allergies: [{ text: 'ALERGIA sintética', criticality: 'critical' }],
  currentMedication: [],
  conditions: [],
  previousSurgeries: [],
  medicalNotes: [],
}

describe('medical-history-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMedicalHistory', () => {
    it('GETs the patient endpoint and unwraps data', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: history } })

      const result = await getMedicalHistory('patient-1')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-1/medical-history')
      expect(result).toEqual(history)
    })

    it('propagates a request failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network Error'))
      await expect(getMedicalHistory('patient-1')).rejects.toThrow('Network Error')
    })
  })

  describe('updateMedicalHistory', () => {
    it('PUTs only the body given and unwraps data', async () => {
      const body = { conditions: [{ text: 'CONDICION sintética', criticality: 'normal' as const }] }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: { ...history, ...body } },
      })

      const result = await updateMedicalHistory('patient-1', body)

      expect(apiClient.put).toHaveBeenCalledWith('/patients/patient-1/medical-history', body)
      expect(result.conditions).toEqual(body.conditions)
    })

    it('propagates a request failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('403'))
      await expect(updateMedicalHistory('patient-1', { allergies: [] })).rejects.toThrow('403')
    })
  })
})
