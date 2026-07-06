import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { LabworkFormModal } from './LabworkFormModal'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getLabNamesMock = vi.fn()
const getAppointmentsByPatientMock = vi.fn()

vi.mock('@/lib/labwork-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/labwork-api')>('@/lib/labwork-api')
  return {
    ...actual,
    getLabNames: (...args: unknown[]) => getLabNamesMock(...args),
  }
})

vi.mock('@/lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointment-api')>('@/lib/appointment-api')
  return {
    ...actual,
    getAppointmentsByPatient: (...args: unknown[]) => getAppointmentsByPatientMock(...args),
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// Test double for the patient combobox: mirrors the real component's public
// contract (selectedPatient / onSelect / onClear) without the debounced
// search internals, which are exercised by PatientSearchCombobox's own tests.
vi.mock('@/components/ui/PatientSearchCombobox', () => ({
  PatientSearchCombobox: ({
    selectedPatient,
    onSelect,
    onClear,
  }: {
    selectedPatient: { id: string; firstName: string; lastName: string } | null
    onSelect: (p: { id: string; firstName: string; lastName: string }) => void
    onClear: () => void
  }) =>
    selectedPatient ? (
      <div>
        <span data-testid="selected-patient">
          {selectedPatient.firstName} {selectedPatient.lastName}
        </span>
        <button type="button" onClick={onClear}>
          Clear patient
        </button>
      </div>
    ) : (
      <div>
        <button
          type="button"
          onClick={() => onSelect({ id: 'patient-1', firstName: 'Ana', lastName: 'Gomez' })}
        >
          Select Ana
        </button>
      </div>
    ),
}))

// ============================================================================
// Helpers
// ============================================================================

function renderModal(props: Partial<ComponentProps<typeof LabworkFormModal>> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <LabworkFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />
  )
  return { onClose, onSubmit, ...utils }
}

function getLabInput() {
  return document.getElementById('lab') as HTMLInputElement
}

async function fillRequiredFieldsAndSubmit(labValue: string, { onSubmit }: { onSubmit: ReturnType<typeof vi.fn> }) {
  fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

  fireEvent.change(getLabInput(), { target: { value: labValue } })
  fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2026-01-15' } })
  fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '100' } })

  fireEvent.click(screen.getByRole('button', { name: 'Crear Trabajo' }))

  await waitFor(() => expect(onSubmit).toHaveBeenCalled())
}

describe('LabworkFormModal — lab name autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAppointmentsByPatientMock.mockResolvedValue([])
  })

  describe('datalist wiring', () => {
    it('fetches lab names on open and renders them as datalist options wired to the input', async () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Beta Lab', 'Alpha Lab'] })

      renderModal()

      expect(getLabNamesMock).toHaveBeenCalledTimes(1)

      const input = getLabInput()
      expect(input).toHaveAttribute('list', 'lab-name-suggestions')

      await waitFor(() => {
        expect(document.getElementById('lab-name-suggestions')).not.toBeNull()
      })
      const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
      await waitFor(() => expect(datalist.querySelectorAll('option')).toHaveLength(2))

      const optionValues = Array.from(datalist.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
      expect(optionValues).toEqual(['Beta Lab', 'Alpha Lab'])
    })

    it('does not fetch lab names while the modal is closed', () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Alpha Lab'] })

      renderModal({ isOpen: false })

      expect(getLabNamesMock).not.toHaveBeenCalled()
    })

    it('renders an empty datalist (not an error) when getLabNames() rejects', async () => {
      getLabNamesMock.mockRejectedValue(new Error('network error'))

      renderModal()

      await waitFor(() => expect(getLabNamesMock).toHaveBeenCalledTimes(1))

      const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
      expect(datalist.querySelectorAll('option')).toHaveLength(0)
    })
  })

  describe('free-text entry', () => {
    it('submits a brand-new lab name that is not among the fetched suggestions', async () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Existing Lab'] })

      const { onSubmit } = renderModal()

      await waitFor(() => {
        const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
        expect(datalist.querySelectorAll('option')).toHaveLength(1)
      })

      await fillRequiredFieldsAndSubmit('Brand New Lab', { onSubmit })

      expect(onSubmit.mock.calls[0][0]).toMatchObject({ lab: 'Brand New Lab' })
    })
  })
})
