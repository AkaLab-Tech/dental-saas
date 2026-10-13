import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { Permission, MEDICAL_HISTORY_FIELDS, type MedicalHistory } from '@dental/shared'
import es from '@/i18n/locales/es.json'
import { MedicalHistoryBlock } from './MedicalHistoryBlock'
import { getMedicalHistory, updateMedicalHistory } from '@/lib/medical-history-api'

// Resolve keys against the real Spanish locale so the asserted strings (the
// "Crítico" badge in particular) are the ones users actually see.
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

const BADGE = 'Crítico'

function emptyHistory(): MedicalHistory {
  return {
    allergies: [],
    currentMedication: [],
    conditions: [],
    previousSurgeries: [],
    medicalNotes: [],
  }
}

function history(partial: Partial<MedicalHistory>): MedicalHistory {
  return { ...emptyHistory(), ...partial }
}

// Fixture texts deliberately never contain the badge word.
const A_HISTORY = history({
  allergies: [{ text: 'ALERGIA-A látex sintético', criticality: 'critical' }],
  conditions: [{ text: 'CONDICION-A hipertensión sintética', criticality: 'normal' }],
})
const B_HISTORY = history({
  medicalNotes: [{ text: 'NOTA-B prefiere mañanas', criticality: 'normal' }],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

async function renderLoaded(data: MedicalHistory, patientId = 'patient-a') {
  getMock.mockResolvedValue(data)
  const utils = render(<MedicalHistoryBlock patientId={patientId} />)
  await settle()
  return utils
}

function openEditor(label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Editar: ${label}` }))
}

describe('MedicalHistoryBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant(Permission.MEDICAL_HISTORY_VIEW, Permission.MEDICAL_HISTORY_UPDATE)
  })

  describe('empty history renders nothing (guard 1)', () => {
    it.each([
      ['an updater', [Permission.MEDICAL_HISTORY_VIEW, Permission.MEDICAL_HISTORY_UPDATE]],
      ['a read-only viewer', [Permission.MEDICAL_HISTORY_VIEW]],
    ])('produces zero DOM for %s when all five sections are empty', async (_label, perms) => {
      grant(...perms)
      const { container } = await renderLoaded(emptyHistory())

      expect(getMock).toHaveBeenCalledTimes(1)
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId('medical-history-block')).not.toBeInTheDocument()
      expect(screen.queryByText('Historia médica')).not.toBeInTheDocument()
      expect(screen.queryByText(BADGE)).not.toBeInTheDocument()
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()
    })

    it('shows all five sections to an updater once any entry exists, empty ones with "Agregar"', async () => {
      await renderLoaded(A_HISTORY)

      const sections = MEDICAL_HISTORY_FIELDS.map((f) =>
        screen.getByTestId(`medical-history-section-${f}`)
      )
      expect(sections).toHaveLength(5)
      expect(within(screen.getByTestId('medical-history-section-currentMedication')).getByText('Agregar')).toBeInTheDocument()
      expect(within(screen.getByTestId('medical-history-section-allergies')).getByText('Editar')).toBeInTheDocument()
    })

    it('shows a read-only viewer only the populated sections', async () => {
      grant(Permission.MEDICAL_HISTORY_VIEW)
      await renderLoaded(A_HISTORY)

      const present = Array.from(
        document.querySelectorAll('[data-testid^="medical-history-section-"]')
      ).map((el) => el.getAttribute('data-field'))
      expect(present).toEqual(['allergies', 'conditions'])
    })
  })

  describe('permission gate (guard 2)', () => {
    it('renders nothing and issues no fetch without MEDICAL_HISTORY_VIEW', async () => {
      grant(Permission.MEDICAL_HISTORY_UPDATE)
      getMock.mockResolvedValue(A_HISTORY)
      const { container } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()

      expect(getMock).toHaveBeenCalledTimes(0)
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId('medical-history-block')).not.toBeInTheDocument()
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
    })
  })

  describe('criticality is not carried by colour alone (guard 3)', () => {
    it('marks the critical entry with attribute and badge, and the routine one with neither', async () => {
      grant(Permission.MEDICAL_HISTORY_VIEW)
      await renderLoaded(
        history({
          allergies: [
            { text: 'ALERGIA-X sintética', criticality: 'critical' },
            { text: 'ALERGIA-Y sintética', criticality: 'normal' },
          ],
        })
      )

      const critical = screen.getByText('ALERGIA-X sintética').closest('li')!
      const routine = screen.getByText('ALERGIA-Y sintética').closest('li')!

      expect(critical).toHaveAttribute('data-criticality', 'critical')
      expect(within(critical).getByText(BADGE)).toBeInTheDocument()
      expect(critical.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      expect(critical.className).toContain('border-red-600')

      expect(routine).toHaveAttribute('data-criticality', 'normal')
      expect(within(routine).queryByText(BADGE)).not.toBeInTheDocument()
      expect(routine.querySelector('svg')).toBeNull()
      expect(routine.className).not.toContain('border-red-600')
      expect(routine.className).not.toContain('font-bold')
    })
  })

  describe('criticality is not escalated across a section (guard 4)', () => {
    it('yields exactly one critical marker among six routine entries and one critical', async () => {
      grant(Permission.MEDICAL_HISTORY_VIEW)
      const routine = Array.from({ length: 6 }, (_, i) => ({
        text: `RUTINA-${i + 1} sintética`,
        criticality: 'normal' as const,
      }))
      await renderLoaded(
        history({
          conditions: [
            ...routine.slice(0, 3),
            { text: 'ALERTA-UNICA sintética', criticality: 'critical' },
            ...routine.slice(3),
          ],
        })
      )

      const section = screen.getByTestId('medical-history-section-conditions')
      expect(section.querySelectorAll('li')).toHaveLength(7)
      expect(section.querySelectorAll('[data-criticality="critical"]')).toHaveLength(1)
      expect(section.querySelectorAll('[data-criticality="normal"]')).toHaveLength(6)
      expect(within(section).queryAllByText(BADGE)).toHaveLength(1)
      expect(section.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
      expect(
        within(section.querySelector('[data-criticality="critical"]') as HTMLElement).getByText(
          'ALERTA-UNICA sintética'
        )
      ).toBeInTheDocument()
    })
  })

  describe('read-only under VIEW without UPDATE (guard 5)', () => {
    it('renders the entries but no edit, add or save affordance', async () => {
      grant(Permission.MEDICAL_HISTORY_VIEW)
      const { container } = await renderLoaded(A_HISTORY)

      expect(screen.getByText('ALERGIA-A látex sintético')).toBeInTheDocument()
      expect(screen.getByText('CONDICION-A hipertensión sintética')).toBeInTheDocument()
      expect(container.querySelectorAll('button')).toHaveLength(0)
      expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0)
      expect(screen.queryByText('Editar')).not.toBeInTheDocument()
      expect(screen.queryByText('Agregar')).not.toBeInTheDocument()
      expect(screen.queryByText('Guardar')).not.toBeInTheDocument()
    })
  })

  describe('form validation gates before the network (guard 6)', () => {
    async function openConditions(data = A_HISTORY) {
      await renderLoaded(data)
      openEditor('Condiciones')
    }

    it('rejects an entry that is empty after trimming', async () => {
      await openConditions()
      fireEvent.change(screen.getByLabelText('Entrada 1'), { target: { value: '   ' } })
      fireEvent.click(screen.getByText('Guardar'))

      expect(await screen.findByRole('alert')).toHaveTextContent('La entrada no puede estar vacía')
      expect(updateMock).toHaveBeenCalledTimes(0)
    })

    it('rejects an entry of 501 characters but would accept 500', async () => {
      await openConditions()
      fireEvent.change(screen.getByLabelText('Entrada 1'), { target: { value: 'a'.repeat(501) } })
      fireEvent.click(screen.getByText('Guardar'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Máximo 500 caracteres')
      expect(updateMock).toHaveBeenCalledTimes(0)
    })

    it('rejects an entry containing a line break', async () => {
      // A text input strips newlines when typed, so the multiline draft can only
      // arrive through loaded data; the form must still refuse to send it.
      await openConditions(
        history({ conditions: [{ text: 'LINEA-1\nLINEA-2', criticality: 'normal' }] })
      )
      fireEvent.click(screen.getByText('Guardar'))

      expect(await screen.findByRole('alert')).toHaveTextContent('una sola línea')
      expect(updateMock).toHaveBeenCalledTimes(0)
    })

    it('rejects a 51st entry with a section-level alert', async () => {
      const fifty = Array.from({ length: 50 }, (_, i) => ({
        text: `ENTRADA-${i + 1}`,
        criticality: 'normal' as const,
      }))
      await openConditions(history({ conditions: fifty }))
      fireEvent.click(screen.getByText('Agregar entrada'))
      fireEvent.change(screen.getByLabelText('Entrada 51'), { target: { value: 'ENTRADA-51' } })
      fireEvent.click(screen.getByText('Guardar'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Máximo 50 entradas por sección')
      expect(updateMock).toHaveBeenCalledTimes(0)
    })

    it('accepts exactly 50 entries of 500 characters and sends them', async () => {
      const fifty = Array.from({ length: 50 }, () => ({
        text: 'b'.repeat(500),
        criticality: 'normal' as const,
      }))
      updateMock.mockResolvedValue(history({ conditions: fifty }))
      await openConditions(history({ conditions: fifty }))
      fireEvent.click(screen.getByText('Guardar'))

      await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('a partial save (guard 7)', () => {
    it('sends only the edited section, trimmed, and shows the returned history', async () => {
      const saved = history({
        allergies: A_HISTORY.allergies,
        conditions: [{ text: 'CONDICION-NUEVA', criticality: 'critical' }],
      })
      updateMock.mockResolvedValue(saved)
      await renderLoaded(A_HISTORY)

      openEditor('Condiciones')
      fireEvent.change(screen.getByLabelText('Entrada 1'), {
        target: { value: '  CONDICION-NUEVA  ' },
      })
      fireEvent.change(screen.getByLabelText('Criticidad'), { target: { value: 'critical' } })
      fireEvent.click(screen.getByText('Guardar'))

      await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
      const [id, body] = updateMock.mock.calls[0]
      expect(id).toBe('patient-a')
      expect(Object.keys(body)).toEqual(['conditions'])
      expect(body).toEqual({ conditions: [{ text: 'CONDICION-NUEVA', criticality: 'critical' }] })

      expect(await screen.findByText('CONDICION-NUEVA')).toBeInTheDocument()
      expect(screen.queryByText('Guardar')).not.toBeInTheDocument()
    })

    it('keeps the editor open with an alert when the save fails', async () => {
      updateMock.mockRejectedValue(new Error('boom'))
      await renderLoaded(A_HISTORY)
      openEditor('Condiciones')
      fireEvent.click(screen.getByText('Guardar'))

      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar')
      expect(screen.getByText('Guardar')).toBeInTheDocument()
    })
  })

  describe('patient-id drift (guard 8)', () => {
    it('shows none of patient A while patient B is still loading', async () => {
      getMock.mockResolvedValueOnce(A_HISTORY)
      const { rerender, container } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()
      expect(screen.getByText('ALERGIA-A látex sintético')).toBeInTheDocument()

      const pendingB = deferred<MedicalHistory>()
      getMock.mockReturnValueOnce(pendingB.promise)
      rerender(<MedicalHistoryBlock patientId="patient-b" />)
      await settle()

      // B's fetch has NOT resolved: this is the transition window.
      expect(getMock).toHaveBeenLastCalledWith('patient-b')
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
      expect(screen.queryByText('CONDICION-A hipertensión sintética')).not.toBeInTheDocument()
      expect(screen.queryByText(BADGE)).not.toBeInTheDocument()
      expect(container).toBeEmptyDOMElement()

      pendingB.resolve(B_HISTORY)
      await settle()
      expect(screen.getByText('NOTA-B prefiere mañanas')).toBeInTheDocument()
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
    })

    it('closes an open editor when the patient changes', async () => {
      getMock.mockResolvedValueOnce(A_HISTORY)
      const { rerender } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()
      openEditor('Condiciones')
      expect(screen.getByLabelText('Entrada 1')).toBeInTheDocument()

      getMock.mockReturnValueOnce(deferred<MedicalHistory>().promise)
      rerender(<MedicalHistoryBlock patientId="patient-b" />)
      await settle()
      expect(screen.queryByLabelText('Entrada 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Guardar')).not.toBeInTheDocument()
    })

    it('does not reopen A\'s editor on patient B once B has loaded', async () => {
      const pendingB = deferred<MedicalHistory>()
      getMock.mockResolvedValueOnce(A_HISTORY).mockReturnValueOnce(pendingB.promise)
      const { rerender } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()
      openEditor('Condiciones')

      rerender(<MedicalHistoryBlock patientId="patient-b" />)
      await settle()
      pendingB.resolve(history({ conditions: [{ text: 'CONDICION-B sintética', criticality: 'normal' }] }))
      await settle()

      expect(screen.getByText('CONDICION-B sintética')).toBeInTheDocument()
      expect(screen.queryByLabelText('Entrada 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Guardar')).not.toBeInTheDocument()
    })

    it('drops A\'s late response that arrives while B is still pending', async () => {
      const pendingA = deferred<MedicalHistory>()
      const pendingB = deferred<MedicalHistory>()
      getMock.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise)
      const { rerender, container } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()
      rerender(<MedicalHistoryBlock patientId="patient-b" />)
      await settle()

      pendingA.resolve(A_HISTORY)
      await settle()
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
      expect(container).toBeEmptyDOMElement()

      pendingB.resolve(B_HISTORY)
      await settle()
      expect(screen.getByText('NOTA-B prefiere mañanas')).toBeInTheDocument()
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
    })

    it('does not let A\'s late response overwrite B once B has already rendered', async () => {
      const pendingA = deferred<MedicalHistory>()
      getMock.mockReturnValueOnce(pendingA.promise).mockResolvedValueOnce(B_HISTORY)
      const { rerender } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()
      rerender(<MedicalHistoryBlock patientId="patient-b" />)
      await settle()
      expect(screen.getByText('NOTA-B prefiere mañanas')).toBeInTheDocument()

      pendingA.resolve(A_HISTORY)
      await settle()
      expect(screen.getByText('NOTA-B prefiere mañanas')).toBeInTheDocument()
      expect(screen.queryByText('ALERGIA-A látex sintético')).not.toBeInTheDocument()
    })
  })

  describe('loading and error windows (guard 9)', () => {
    it('renders nothing while the fetch is pending', async () => {
      getMock.mockReturnValue(deferred<MedicalHistory>().promise)
      const { container } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()

      expect(getMock).toHaveBeenCalledTimes(1)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing after a failed fetch and surfaces no error', async () => {
      getMock.mockRejectedValue(new Error('network down'))
      const { container } = render(<MedicalHistoryBlock patientId="patient-a" />)
      await settle()

      expect(getMock).toHaveBeenCalledTimes(1)
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
