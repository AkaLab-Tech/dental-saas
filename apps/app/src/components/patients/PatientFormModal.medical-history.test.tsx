import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { Permission, MEDICAL_HISTORY_FIELDS, type MedicalHistory } from '@dental/shared'
import es from '@/i18n/locales/es.json'
import { PatientFormModal } from './PatientFormModal'
import type { Patient } from '@/lib/patient-api'
import { getMedicalHistory, updateMedicalHistory } from '@/lib/medical-history-api'

// Resolve keys against the real Spanish locale, as MedicalHistoryBlock.test does.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const found = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], es)
      if (typeof found !== 'string') return key
      return found.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? ''))
    },
    i18n: { language: 'es' },
  }),
}))

const granted = new Set<string>()
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (p: string) => granted.has(p) }),
}))

vi.mock('@/lib/medical-history-api', () => ({
  getMedicalHistory: vi.fn(),
  updateMedicalHistory: vi.fn(),
}))

const getMock = vi.mocked(getMedicalHistory)
const updateMock = vi.mocked(updateMedicalHistory)

const mockPatient: Patient = {
  id: 'patient-a',
  tenantId: 'tenant1',
  firstName: 'Paciente',
  lastName: 'Sintetico',
  email: 'sintetico@example.com',
  phone: '+1234567890',
  dob: '1990-01-15T00:00:00Z',
  gender: 'male',
  address: '123 Main St, City',
  toothNotes: {},
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

function emptyHistory(): MedicalHistory {
  return {
    allergies: [],
    currentMedication: [],
    conditions: [],
    previousSurgeries: [],
    medicalNotes: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function grant(...permissions: Permission[]) {
  granted.clear()
  permissions.forEach((p) => granted.add(p))
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const onClose = vi.fn()
const onSubmit = vi.fn()

async function renderModal(patient?: Patient) {
  const utils = render(
    <PatientFormModal isOpen={true} onClose={onClose} onSubmit={onSubmit} patient={patient} />
  )
  await settle()
  return utils
}

// jsdom does not implement a browser's implicit submission (Enter inside a text
// input submits the input's form). This reproduces it: dispatch the key, and if
// nothing cancelled it and the input belongs to a form, request that form's submit.
function pressEnter(input: HTMLElement) {
  const notCancelled = fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  const form = (input as HTMLInputElement).form
  if (notCancelled && form) form.requestSubmit()
}

describe('PatientFormModal medical history entry point (#557)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant(Permission.MEDICAL_HISTORY_VIEW, Permission.MEDICAL_HISTORY_UPDATE)
    getMock.mockResolvedValue(emptyHistory())
    onSubmit.mockResolvedValue(undefined)
  })

  describe('permission gate (guard 2)', () => {
    it.each([
      ['no medical permission at all', []],
      ['VIEW without UPDATE', [Permission.MEDICAL_HISTORY_VIEW]],
    ])('renders no section and no affordance, and never fetches, with %s', async (_l, perms) => {
      grant(...perms)
      await renderModal(mockPatient)

      expect(getMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('medical-history-edit')).not.toBeInTheDocument()
      expect(document.querySelectorAll('[data-testid^="medical-history-section-"]')).toHaveLength(0)
      expect(screen.queryByText('Historial Médico')).not.toBeInTheDocument()
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()
      expect(screen.queryByText('Editar')).not.toBeInTheDocument()
    })
  })

  describe('create mode (guard 3)', () => {
    it('renders no medical section and issues no fetch when there is no patient', async () => {
      await renderModal(undefined)

      expect(screen.getByText('Nuevo Paciente')).toBeInTheDocument()
      expect(getMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('medical-history-edit')).not.toBeInTheDocument()
      expect(document.querySelectorAll('[data-testid^="medical-history-section-"]')).toHaveLength(0)
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()
    })
  })

  describe('empty history (guard 4)', () => {
    it('shows all five sections, each with exactly one "Agregar" affordance', async () => {
      await renderModal(mockPatient)

      expect(getMock).toHaveBeenCalledTimes(1)
      expect(getMock).toHaveBeenCalledWith('patient-a')
      expect(screen.getByTestId('medical-history-edit')).toBeInTheDocument()
      const present = Array.from(
        document.querySelectorAll('[data-testid^="medical-history-section-"]')
      ).map((el) => el.getAttribute('data-field'))
      expect(present).toEqual([...MEDICAL_HISTORY_FIELDS])
      for (const field of MEDICAL_HISTORY_FIELDS) {
        const section = screen.getByTestId(`medical-history-section-${field}`)
        expect(within(section).getAllByRole('button', { name: /^Editar: / })).toHaveLength(1)
        expect(within(section).getAllByText('Agregar')).toHaveLength(1)
      }
      expect(screen.getAllByText('Agregar')).toHaveLength(5)
    })

    it('shows nothing while the read is still pending (asserted inside the window)', async () => {
      const pending = deferred<MedicalHistory>()
      getMock.mockReturnValue(pending.promise)
      await renderModal(mockPatient)

      expect(getMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('medical-history-edit')).not.toBeInTheDocument()
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()

      pending.resolve(emptyHistory())
      await settle()
      expect(screen.getAllByText('Agregar')).toHaveLength(5)
    })

    it('shows nothing after a failed read', async () => {
      getMock.mockRejectedValue(new Error('boom'))
      await renderModal(mockPatient)

      expect(screen.queryByTestId('medical-history-edit')).not.toBeInTheDocument()
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()
    })
  })

  describe('a first entry saves only its own section (guard 5)', () => {
    it('sends a body whose key set is exactly the edited field, and does not submit the patient form', async () => {
      const saved = { ...emptyHistory(), conditions: [{ text: 'HIPERTENSION-X', criticality: 'normal' as const }] }
      updateMock.mockResolvedValue(saved)
      await renderModal(mockPatient)

      fireEvent.click(screen.getByRole('button', { name: 'Editar: Condiciones' }))
      fireEvent.click(screen.getByText('Agregar entrada'))
      fireEvent.change(screen.getByLabelText('Entrada 1'), { target: { value: '  HIPERTENSION-X  ' } })
      fireEvent.click(screen.getByText('Guardar'))

      await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
      const [id, body] = updateMock.mock.calls[0]
      expect(id).toBe('patient-a')
      expect(Object.keys(body)).toEqual(['conditions'])
      expect(body).toEqual({ conditions: [{ text: 'HIPERTENSION-X', criticality: 'normal' }] })

      expect(await screen.findByText('HIPERTENSION-X')).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Enter in an entry input (guard 6)', () => {
    it('does not submit the patient form', async () => {
      await renderModal(mockPatient)

      fireEvent.click(screen.getByRole('button', { name: 'Editar: Alergias' }))
      fireEvent.click(screen.getByText('Agregar entrada'))
      const input = screen.getByLabelText('Entrada 1')
      fireEvent.change(input, { target: { value: 'LATEX-X' } })

      // Structural anchor: the entry input belongs to no form at all.
      expect((input as HTMLInputElement).form).toBeNull()

      pressEnter(input)
      await settle()

      expect(onSubmit).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('the patient form still submits (guard 7)', () => {
    it('edit: "Guardar Cambios", rendered outside the form, still submits it exactly once', async () => {
      await renderModal(mockPatient)

      fireEvent.change(screen.getByPlaceholderText('Juan'), { target: { value: 'Editado' } })
      fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Editado', lastName: 'Sintetico' })
      )
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('create: "Crear Paciente" still submits the entered values exactly once', async () => {
      await renderModal(undefined)

      fireEvent.change(screen.getByPlaceholderText('Juan'), { target: { value: 'Nuevo' } })
      fireEvent.change(screen.getByPlaceholderText('Pérez'), { target: { value: 'Otro' } })
      fireEvent.change(screen.getByPlaceholderText('paciente@email.com'), {
        target: { value: 'nuevo@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('+1 234 567 890'), {
        target: { value: '+1234567890' },
      })
      fireEvent.click(screen.getByRole('button', { name: /crear paciente/i }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Nuevo', lastName: 'Otro', email: 'nuevo@example.com' })
      )
    })

    it('the submit button is associated to the form by id, not by nesting', async () => {
      await renderModal(mockPatient)

      const button = screen.getByRole('button', { name: /guardar cambios/i }) as HTMLButtonElement
      const form = document.getElementById('patient-form') as HTMLFormElement
      expect(form).not.toBeNull()
      expect(form.contains(button)).toBe(false)
      expect(button.form).toBe(form)
    })
  })
})
