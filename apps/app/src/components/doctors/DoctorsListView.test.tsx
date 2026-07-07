import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { DoctorsListView } from './DoctorsListView'
import type { Doctor } from '@/lib/doctor-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

function makeDoctor(overrides: Partial<Doctor>): Doctor {
  return {
    id: 'base',
    tenantId: 'tenant1',
    firstName: 'First',
    lastName: 'Last',
    email: 'a@example.com',
    phone: '+1000000000',
    specialty: 'General',
    licenseNumber: 'LIC0',
    workingDays: ['MON', 'WED'],
    workingHours: null,
    consultingRoom: null,
    avatar: null,
    bio: null,
    hourlyRate: null,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// Fixtures chosen so that name/specialty ascending sort orders differ.
const doctorAna = makeDoctor({
  id: 'd-ana',
  firstName: 'Ana',
  lastName: 'Alfa',
  specialty: 'Ortodoncia',
  isActive: true,
})
const doctorBeto = makeDoctor({
  id: 'd-beto',
  firstName: 'Beto',
  lastName: 'Middle',
  specialty: null,
  isActive: false,
})
const doctorCarlos = makeDoctor({
  id: 'd-carlos',
  firstName: 'Carlos',
  lastName: 'Zeta',
  specialty: 'Endodoncia',
  isActive: true,
})

const doctors = [doctorCarlos, doctorAna, doctorBeto]

function renderView(props?: {
  onEdit?: (d: Doctor) => void
  onDelete?: (d: Doctor) => void
  onRestore?: ((d: Doctor) => void) | undefined
  list?: Doctor[]
}) {
  const onEdit = props?.onEdit ?? vi.fn()
  const onDelete = props?.onDelete ?? vi.fn()
  const onRestore = 'onRestore' in (props ?? {}) ? props?.onRestore : vi.fn()
  const utils = render(
    <MemoryRouter>
      <DoctorsListView
        doctors={props?.list ?? doctors}
        onEdit={onEdit}
        onDelete={onDelete}
        onRestore={onRestore}
      />
    </MemoryRouter>
  )
  return { ...utils, onEdit, onDelete, onRestore }
}

function desktopSection(container: HTMLElement) {
  const el = container.querySelector('.hidden.lg\\:block')
  if (!el) throw new Error('desktop table section not found')
  return el as HTMLElement
}

function mobileSection(container: HTMLElement) {
  const el = container.querySelector('.lg\\:hidden')
  if (!el) throw new Error('mobile list section not found')
  return el as HTMLElement
}

function desktopRowNames(container: HTMLElement) {
  return Array.from(desktopSection(container).querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelector('td p')!.textContent!.trim()
  )
}

function mobileRowNames(container: HTMLElement) {
  return Array.from(mobileSection(container).querySelectorAll(':scope > div')).map(
    (div) => div.querySelector('p.font-medium')!.textContent!.trim()
  )
}

describe('DoctorsListView', () => {
  describe('desktop table vs mobile list presence', () => {
    it('renders both the lg+ table and the sub-lg list markup', () => {
      const { container } = renderView()

      expect(desktopSection(container).querySelector('table')).toBeInTheDocument()
      expect(mobileSection(container).querySelectorAll(':scope > div')).toHaveLength(3)
    })
  })

  describe('shared sorted array', () => {
    it('renders the desktop table and mobile list in the same sorted order (default: name asc)', () => {
      const { container } = renderView()

      const expected = ['Dr. Ana Alfa', 'Dr. Beto Middle', 'Dr. Carlos Zeta']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })

    it('sorts by specialty ascending (nulls first) after clicking the specialty header', () => {
      const { container } = renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Especialidad' }))

      // Beto (no specialty) < Carlos (Endodoncia) < Ana (Ortodoncia)
      const expected = ['Dr. Beto Middle', 'Dr. Carlos Zeta', 'Dr. Ana Alfa']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })
  })

  describe('sort toggle + aria-sort transitions', () => {
    // aria-sort lives on the <th role="columnheader">, not the inner <button>
    // (WAI-ARIA: aria-sort belongs on the columnheader). The button is still
    // the click/keyboard toggle target.
    it('defaults to name ascending with specialty at none', () => {
      renderView()

      expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: 'Especialidad' })).toHaveAttribute('aria-sort', 'none')
    })

    it('toggles name to descending on a second click of the same header', () => {
      renderView()

      const nameButton = screen.getByRole('button', { name: 'Nombre' })
      const nameHeader = screen.getByRole('columnheader', { name: 'Nombre' })
      fireEvent.click(nameButton)

      expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    })

    it('resets the previously active column to none when a different column becomes active', () => {
      renderView()

      const nameHeader = screen.getByRole('columnheader', { name: 'Nombre' })
      const specialtyButton = screen.getByRole('button', { name: 'Especialidad' })
      const specialtyHeader = screen.getByRole('columnheader', { name: 'Especialidad' })

      fireEvent.click(specialtyButton)

      expect(specialtyHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    })

    it('reverses the sorted order when toggling the active column direction', () => {
      const { container } = renderView()

      const nameButton = screen.getByRole('button', { name: 'Nombre' })
      const nameHeader = screen.getByRole('columnheader', { name: 'Nombre' })
      fireEvent.click(nameButton) // asc -> desc

      expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      expect(desktopRowNames(container)).toEqual(['Dr. Carlos Zeta', 'Dr. Beto Middle', 'Dr. Ana Alfa'])
    })
  })

  describe('row action handler dispatch', () => {
    it('renders a link to the doctor record with the correct href', () => {
      renderView()

      // Default sort is name asc, so the first rendered row is Ana Alfa.
      const links = screen.getAllByRole('link', { name: 'Ver detalle' })
      expect(links.length).toBeGreaterThan(0)
      expect(links[0]).toHaveAttribute('href', `/doctors/${doctorAna.id}`)
    })

    it('calls onEdit with the correct doctor when Edit is clicked', () => {
      const onEdit = vi.fn()
      renderView({ onEdit, list: [doctorCarlos] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])

      expect(onEdit).toHaveBeenCalledTimes(1)
      expect(onEdit).toHaveBeenCalledWith(doctorCarlos)
    })

    it('calls onDelete with the correct doctor when Delete is clicked', () => {
      const onDelete = vi.fn()
      renderView({ onDelete, list: [doctorCarlos] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onDelete).toHaveBeenCalledWith(doctorCarlos)
    })

    it('calls onRestore with the correct doctor when Restore is clicked on an inactive row', () => {
      const onRestore = vi.fn()
      renderView({ onRestore, list: [doctorBeto] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Restaurar' })[0])

      expect(onRestore).toHaveBeenCalledTimes(1)
      expect(onRestore).toHaveBeenCalledWith(doctorBeto)
    })
  })

  describe('active vs inactive row rendering', () => {
    it('shows Edit and Delete (not Restore) for active rows', () => {
      const { container } = renderView({ list: [doctorCarlos] })

      const desktopRow = desktopSection(container).querySelector('tbody tr')!
      expect(within(desktopRow).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
    })

    it('shows Restore (not Edit/Delete) for inactive rows when onRestore is provided', () => {
      const { container } = renderView({ list: [doctorBeto] })

      const desktopRow = desktopSection(container).querySelector('tbody tr')!
      expect(within(desktopRow).getByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
    })

    it('falls back to Edit/Delete for inactive rows when onRestore is not provided', () => {
      const { container } = renderView({ list: [doctorBeto], onRestore: undefined })

      const desktopRow = desktopSection(container).querySelector('tbody tr')!
      expect(within(desktopRow).queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    })

    it('shows the inactive badge in the mobile row for inactive doctors', () => {
      const { container } = renderView({ list: [doctorBeto] })

      expect(within(mobileSection(container)).getByText('Inactivo')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('renders sortable headers as button elements', () => {
      renderView()

      expect(screen.getByRole('button', { name: 'Nombre' }).tagName).toBe('BUTTON')
      expect(screen.getByRole('button', { name: 'Especialidad' }).tagName).toBe('BUTTON')
    })

    it('keeps icon + text on row actions (not icon-only)', () => {
      const { container } = renderView({ list: [doctorCarlos] })

      const desktopRow = desktopSection(container).querySelector('tbody tr')!
      const editButton = within(desktopRow).getByRole('button', { name: 'Editar' })

      expect(editButton.querySelector('svg')).toBeInTheDocument()
      expect(editButton.textContent).toMatch(/Editar/)
    })
  })
})
