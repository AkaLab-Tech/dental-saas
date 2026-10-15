import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { PatientsListView } from './PatientsListView'
import type { Patient } from '@/lib/patient-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

function makePatient(overrides: Partial<Patient>): Patient {
  return {
    id: 'base',
    tenantId: 'tenant1',
    firstName: 'First',
    lastName: 'Last',
    email: 'a@example.com',
    phone: '+1000000000',
    dob: '2000-01-01',
    gender: 'male',
    coverageType: 'PARTICULAR',
    convenioName: null,
    address: null,
    notes: null,
    teeth: null,
    showPrimaryTeeth: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// Fixtures chosen so that name/gender/dob ascending sort orders differ,
// pinning down exactly which sequence each sort key produces.
const patientAna = makePatient({
  id: 'p-ana',
  firstName: 'Ana',
  lastName: 'Alfa',
  gender: 'female',
  dob: '1985-05-15',
  isActive: true,
})
const patientBeto = makePatient({
  id: 'p-beto',
  firstName: 'Beto',
  lastName: 'Middle',
  gender: null,
  dob: null,
  isActive: false,
})
const patientCarlos = makePatient({
  id: 'p-carlos',
  firstName: 'Carlos',
  lastName: 'Zeta',
  gender: 'male',
  dob: '1990-01-01',
  isActive: true,
})

const patients = [patientCarlos, patientAna, patientBeto]

function renderView(props?: {
  onEdit?: (p: Patient) => void
  onDelete?: (p: Patient) => void
  onRestore?: ((p: Patient) => void) | undefined
  list?: Patient[]
}) {
  const onEdit = props?.onEdit ?? vi.fn()
  const onDelete = props?.onDelete ?? vi.fn()
  const onRestore = 'onRestore' in (props ?? {}) ? props?.onRestore : vi.fn()
  const utils = render(
    <MemoryRouter>
      <PatientsListView
        patients={props?.list ?? patients}
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

describe('PatientsListView', () => {
  describe('desktop table vs mobile list presence', () => {
    it('renders both the lg+ table and the sub-lg list markup', () => {
      const { container } = renderView()

      expect(desktopSection(container).querySelector('table')).toBeInTheDocument()
      expect(mobileSection(container).querySelectorAll(':scope > div')).toHaveLength(3)
    })
  })

  describe('shared sorted array', () => {
    // #566 GUARD 1: the name order is the server's, so the view displays the array it
    // was given. `patients` (Zeta, Alfa, Middle) is in no name order at all -- not by
    // family name and not by given name (Carlos, Ana, Beto) -- so any comparator
    // reintroduced in the 'name' case reorders it and this goes red.
    it('renders the desktop table and mobile list in the order received (default: name asc)', () => {
      const { container } = renderView()

      const expected = ['Carlos Zeta', 'Ana Alfa', 'Beto Middle']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })

    it('sorts by gender ascending (nulls first) after clicking the gender/age header', () => {
      const { container } = renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Género / Edad' }))

      // Beto (no gender) < Ana (female) < Carlos (male)
      const expected = ['Beto Middle', 'Ana Alfa', 'Carlos Zeta']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })

    it('sorts by date of birth ascending (nulls first) after clicking the dob header', () => {
      const { container } = renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Fecha de nacimiento' }))

      // Beto (no dob) < Ana (1985) < Carlos (1990)
      const expected = ['Beto Middle', 'Ana Alfa', 'Carlos Zeta']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })
  })

  // #566 GUARDS 3 + 4. The list arrives from the server ordered by FAMILY name
  // (then given name). The old client comparator re-sorted by the joined
  // "given family" string, i.e. by GIVEN name, so the two orders only disagree when
  // the given names run against the family names. These three do: in server order
  // the given names are Zoe, Ana, Bruno -- the old comparator would put Ana first and
  // Zoe last.
  describe('family-name order from the server (#566)', () => {
    const zoeAlba = makePatient({ id: 'f-zoe', firstName: 'Zoe', lastName: 'Alba' })
    const anaMora = makePatient({ id: 'f-ana', firstName: 'Ana', lastName: 'Mora' })
    const brunoSoto = makePatient({ id: 'f-bruno', firstName: 'Bruno', lastName: 'Soto' })
    const serverOrder = [zoeAlba, anaMora, brunoSoto]
    const label = (p: Patient) => `${p.firstName} ${p.lastName}`

    it('the fixture orders differently by family name than by given name (vacuity check)', () => {
      const byFamily = [...serverOrder].sort((a, b) => a.lastName.localeCompare(b.lastName)).map(label)
      const byGiven = [...serverOrder].sort((a, b) => a.firstName.localeCompare(b.firstName)).map(label)
      expect(byFamily).toEqual(['Zoe Alba', 'Ana Mora', 'Bruno Soto'])
      expect(byGiven).toEqual(['Ana Mora', 'Bruno Soto', 'Zoe Alba'])
      expect(byFamily).not.toEqual(byGiven)
      // and the array handed to the view is the family order
      expect(serverOrder.map(label)).toEqual(byFamily)
    })

    it('displays the family-name order, on both the table and the mobile list', () => {
      const { container } = renderView({ list: serverOrder })

      const expected = ['Zoe Alba', 'Ana Mora', 'Bruno Soto']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })

    it('desc is the exact reverse of the family-name order', () => {
      const { container } = renderView({ list: serverOrder })

      fireEvent.click(screen.getByRole('button', { name: 'Nombre' }))

      const expected = ['Bruno Soto', 'Ana Mora', 'Zoe Alba']
      expect(desktopRowNames(container)).toEqual(expected)
      expect(mobileRowNames(container)).toEqual(expected)
    })
  })

  describe('sort toggle + aria-sort transitions', () => {
    // aria-sort lives on the <th role="columnheader">, not the inner <button>
    // (WAI-ARIA: aria-sort belongs on the columnheader). The button is still
    // the click/keyboard toggle target.
    it('defaults to name ascending with other columns at none', () => {
      renderView()

      expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: 'Género / Edad' })).toHaveAttribute('aria-sort', 'none')
      expect(screen.getByRole('columnheader', { name: 'Fecha de nacimiento' })).toHaveAttribute(
        'aria-sort',
        'none'
      )
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
      const genderButton = screen.getByRole('button', { name: 'Género / Edad' })
      const genderHeader = screen.getByRole('columnheader', { name: 'Género / Edad' })

      fireEvent.click(genderButton)

      expect(genderHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    })

    // #566 GUARD 2: desc is the explicit reversal of the given array, not a re-sort.
    it('reverses the order received when toggling the active column direction', () => {
      const { container } = renderView()

      const nameButton = screen.getByRole('button', { name: 'Nombre' })
      const nameHeader = screen.getByRole('columnheader', { name: 'Nombre' })
      fireEvent.click(nameButton) // asc -> desc

      expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      const reversed = [...patients].reverse().map((p) => `${p.firstName} ${p.lastName}`)
      expect(reversed).toEqual(['Beto Middle', 'Ana Alfa', 'Carlos Zeta'])
      expect(desktopRowNames(container)).toEqual(reversed)
      expect(mobileRowNames(container)).toEqual(reversed)
    })
  })

  describe('row action handler dispatch', () => {
    it('renders a link to the patient record with the correct href', () => {
      renderView()

      // Default sort is name asc = the order received, so the first rendered row is
      // the first patient of the array (Carlos Zeta), not the alphabetically first.
      const links = screen.getAllByRole('link', { name: 'Ver ficha' })
      expect(links.length).toBeGreaterThan(0)
      expect(links[0]).toHaveAttribute('href', `/patients/${patientCarlos.id}`)
    })

    it('calls onEdit with the correct patient when Edit is clicked', () => {
      const onEdit = vi.fn()
      renderView({ onEdit, list: [patientCarlos] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])

      expect(onEdit).toHaveBeenCalledTimes(1)
      expect(onEdit).toHaveBeenCalledWith(patientCarlos)
    })

    it('calls onDelete with the correct patient when Delete is clicked', () => {
      const onDelete = vi.fn()
      renderView({ onDelete, list: [patientCarlos] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onDelete).toHaveBeenCalledWith(patientCarlos)
    })

    it('calls onRestore with the correct patient when Restore is clicked on an inactive row', () => {
      const onRestore = vi.fn()
      renderView({ onRestore, list: [patientBeto] })

      fireEvent.click(screen.getAllByRole('button', { name: 'Restaurar' })[0])

      expect(onRestore).toHaveBeenCalledTimes(1)
      expect(onRestore).toHaveBeenCalledWith(patientBeto)
    })
  })

  describe('active vs inactive row rendering', () => {
    it('shows Edit and Delete (not Restore) for active rows', () => {
      const { container } = renderView({ list: [patientCarlos] })

      const desktopRow = desktopSection(container).querySelector<HTMLElement>('tbody tr')!
      expect(within(desktopRow).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
    })

    it('shows Restore (not Edit/Delete) for inactive rows when onRestore is provided', () => {
      const { container } = renderView({ list: [patientBeto] })

      const desktopRow = desktopSection(container).querySelector<HTMLElement>('tbody tr')!
      expect(within(desktopRow).getByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
      expect(within(desktopRow).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
    })

    it('falls back to Edit/Delete for inactive rows when onRestore is not provided', () => {
      const { container } = renderView({ list: [patientBeto], onRestore: undefined })

      const desktopRow = desktopSection(container).querySelector<HTMLElement>('tbody tr')!
      expect(within(desktopRow).queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
      expect(within(desktopRow).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    })

    it('shows the inactive badge in the mobile row for inactive patients', () => {
      const { container } = renderView({ list: [patientBeto] })

      expect(within(mobileSection(container)).getByText('Inactivo')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('renders sortable headers as button elements', () => {
      renderView()

      expect(screen.getByRole('button', { name: 'Nombre' }).tagName).toBe('BUTTON')
      expect(screen.getByRole('button', { name: 'Género / Edad' }).tagName).toBe('BUTTON')
      expect(screen.getByRole('button', { name: 'Fecha de nacimiento' }).tagName).toBe('BUTTON')
    })

    it('keeps icon + text on row actions (not icon-only)', () => {
      const { container } = renderView({ list: [patientCarlos] })

      const desktopRow = desktopSection(container).querySelector<HTMLElement>('tbody tr')!
      const editButton = within(desktopRow).getByRole('button', { name: 'Editar' })

      expect(editButton.querySelector('svg')).toBeInTheDocument()
      expect(editButton.textContent).toMatch(/Editar/)
    })
  })
})
