import { useState } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { DoctorPicker, type DoctorOption } from './DoctorPicker'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// Fixture doctors deliberately include accented characters (José, Muñoz) so
// the accent-insensitive filtering tests exercise real Unicode combining
// marks, not ASCII-only stand-ins.
const doctors: DoctorOption[] = [
  { id: 'doc-1', firstName: 'José', lastName: 'García', specialty: 'Ortodoncia' },
  { id: 'doc-2', firstName: 'Ana', lastName: 'Muñoz', specialty: 'Endodoncia' },
  { id: 'doc-3', firstName: 'Carlos', lastName: 'Ruiz', specialty: 'Odontología General' },
]

function getInput() {
  return screen.getByRole('combobox') as HTMLInputElement
}

function optionTexts() {
  return screen.getAllByRole('option').map((o) => o.textContent)
}

// Opens the list (focus shows the full list with nothing typed yet) and
// types the given query, which triggers filtering.
function typeQuery(text: string) {
  const input = getInput()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: text } })
}

describe('DoctorPicker', () => {
  describe('filtering', () => {
    it('matches a plain substring of the last name', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('Ruiz')
      expect(optionTexts()).toEqual(['Carlos Ruiz (Odontología General)'])
    })

    it('matches case-insensitively', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('CARLOS')
      expect(optionTexts()).toEqual(['Carlos Ruiz (Odontología General)'])
    })

    it('matches accent-insensitively: "jose" matches "José"', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('jose')
      expect(optionTexts()).toEqual(['José García (Ortodoncia)'])
    })

    it('matches accent-insensitively: "munoz" matches "Muñoz"', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('munoz')
      expect(optionTexts()).toEqual(['Ana Muñoz (Endodoncia)'])
    })

    it('matches on specialty, not just name', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('Endodoncia')
      expect(optionTexts()).toEqual(['Ana Muñoz (Endodoncia)'])
    })

    // Spans the firstName/lastName boundary: "é García" is not a substring
    // of firstName ("José") alone nor of lastName ("García") alone, only of
    // the concatenated "José García" full name.
    it('matches the full name across the first/last name boundary', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('é García')
      expect(optionTexts()).toEqual(['José García (Ortodoncia)'])
    })

    it('shows the localized no-results message and no options when nothing matches', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      typeQuery('zzz-no-match')
      expect(screen.getByText('No se encontraron doctores')).toBeInTheDocument()
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    })

    it('shows the full unfiltered list when focused with no typed character', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      fireEvent.focus(getInput())
      expect(optionTexts()).toHaveLength(3)
    })

    it('shows the full unfiltered list when opened via ArrowDown with no typed character', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
      expect(optionTexts()).toHaveLength(3)
    })
  })

  describe('keyboard navigation', () => {
    it('ArrowDown opens a closed list with the first option made active', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      expect(input).toHaveAttribute('aria-expanded', 'true')
      const options = screen.getAllByRole('option')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0].getAttribute('id'))
    })

    it('ArrowDown wraps from the last option back to the first', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // opens, active index 0
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // index 1
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // index 2 (last)
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // wraps to 0

      const options = screen.getAllByRole('option')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0].getAttribute('id'))
    })

    it('ArrowUp wraps from the first option to the last', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // opens, active index 0
      fireEvent.keyDown(input, { key: 'ArrowUp' }) // wraps to the last option

      const options = screen.getAllByRole('option')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[2].getAttribute('id'))
    })

    it('Enter selects the active option and calls onChange with its id', () => {
      const onChange = vi.fn()
      render(<DoctorPicker doctors={doctors} value="" onChange={onChange} />)
      const input = getInput()
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // index 0 -> doc-1
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // index 1 -> doc-2
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('doc-2')
    })

    it('Enter with no active option does not call onChange', () => {
      const onChange = vi.fn()
      render(<DoctorPicker doctors={doctors} value="" onChange={onChange} />)
      const input = getInput()
      fireEvent.focus(input) // opens without moving activeIndex off -1
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onChange).not.toHaveBeenCalled()
    })

    it('Escape closes the list and stops propagation so a host onKeyDown handler never sees it', () => {
      const hostKeyDown = vi.fn()
      render(
        <div onKeyDown={hostKeyDown}>
          <DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />
        </div>
      )
      const input = getInput()
      fireEvent.focus(input)
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(hostKeyDown).not.toHaveBeenCalled()
    })

    it('Escape reverts an in-progress, uncommitted query back to the selected label', () => {
      render(<DoctorPicker doctors={doctors} value="doc-3" onChange={vi.fn()} />)
      const input = getInput()
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'something else entirely' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(input.value).toBe('Carlos Ruiz (Odontología General)')
    })

    // jsdom does not simulate real Tab-triggered focus traversal via
    // fireEvent.keyDown (same convention as TimePicker.test.tsx), so this
    // dispatches a native blur event with relatedTarget set explicitly,
    // mirroring what the browser does when Tab moves focus onward.
    it('closes the list when Tab moves focus outside (simulated via blur)', () => {
      render(
        <div>
          <DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />
          <button type="button">next field</button>
        </div>
      )
      const input = getInput()
      fireEvent.focus(input)
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'next field' }) })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('closes the list when clicking outside the component', () => {
      render(
        <div>
          <DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />
          <button type="button">outside</button>
        </div>
      )
      const input = getInput()
      fireEvent.focus(input)
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  describe('clear button', () => {
    it('has an accessible name from doctorPicker.clear and calls onChange(\'\') when clicked', () => {
      const onChange = vi.fn()
      render(<DoctorPicker doctors={doctors} value="doc-1" onChange={onChange} />)

      const clearButton = screen.getByRole('button', { name: 'Quitar doctor' })
      fireEvent.click(clearButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('')
    })

    it('is not rendered when value is empty', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Quitar doctor' })).not.toBeInTheDocument()
    })
  })

  describe('disabled and loading states', () => {
    it('disables the input and hides the clear button when disabled', () => {
      render(<DoctorPicker doctors={doctors} value="doc-1" onChange={vi.fn()} disabled />)
      expect(getInput()).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Quitar doctor' })).not.toBeInTheDocument()
    })

    it('disables the input and shows a loading spinner instead of the clear button when loading', () => {
      const { container } = render(<DoctorPicker doctors={doctors} value="doc-1" onChange={vi.fn()} loading />)
      expect(getInput()).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Quitar doctor' })).not.toBeInTheDocument()
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('does not open the list on ArrowDown when disabled', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} disabled />)
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('sets aria-invalid and wires aria-describedby to the rendered error message', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} error="El doctor es requerido" />)
      const input = getInput()
      expect(input).toHaveAttribute('aria-invalid', 'true')

      const describedBy = input.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy as string)).toHaveTextContent('El doctor es requerido')
    })

    it('does not set aria-invalid and has no aria-describedby when there is no error', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).toHaveAttribute('aria-invalid', 'false')
      expect(input).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('fallback', () => {
    const inactiveDoctor: DoctorOption = {
      id: 'doc-inactive',
      firstName: 'Elena',
      lastName: 'Vidal',
      specialty: 'Cirugía',
    }

    it('shows the fallback doctor label when value points at a doctor missing from doctors (e.g. an inactive doctor)', () => {
      render(<DoctorPicker doctors={doctors} value="doc-inactive" onChange={vi.fn()} fallback={inactiveDoctor} />)
      expect(getInput().value).toBe('Elena Vidal (Cirugía)')
    })

    it('prefers a doctor present in `doctors` over `fallback` when both could match the value', () => {
      const staleFallback: DoctorOption = { id: 'doc-1', firstName: 'Wrong', lastName: 'Name', specialty: null }
      render(<DoctorPicker doctors={doctors} value="doc-1" onChange={vi.fn()} fallback={staleFallback} />)
      expect(getInput().value).toBe('José García (Ortodoncia)')
    })

    it('shows nothing when value is empty, even with a fallback set', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} fallback={inactiveDoctor} />)
      expect(getInput().value).toBe('')
    })

    it('shows nothing when value matches neither doctors nor fallback', () => {
      render(<DoctorPicker doctors={doctors} value="doc-unknown" onChange={vi.fn()} fallback={inactiveDoctor} />)
      expect(getInput().value).toBe('')
    })
  })

  // The single most important a11y assertion here (see the #463 lesson):
  // the combobox must remain reachable via its associated <label> both
  // before and after a selection changes the displayed text.
  describe('label association (#463)', () => {
    function LabeledPicker({ initialValue = '' }: { initialValue?: string }) {
      const [value, setValue] = useState(initialValue)
      return (
        <div>
          <label htmlFor="doctor-field">Doctor</label>
          <DoctorPicker id="doctor-field" doctors={doctors} value={value} onChange={setValue} />
        </div>
      )
    }

    it('is findable via getByLabelText before any selection is made', () => {
      render(<LabeledPicker />)
      expect(screen.getByLabelText('Doctor')).toBe(screen.getByRole('combobox'))
    })

    it('remains findable via getByLabelText, and shows the new label, after a selection is made', () => {
      render(<LabeledPicker />)
      const input = screen.getByLabelText('Doctor')
      fireEvent.focus(input)
      fireEvent.click(screen.getByRole('option', { name: 'José García (Ortodoncia)' }))

      const inputAfter = screen.getByLabelText('Doctor')
      expect(inputAfter).toBe(screen.getByRole('combobox'))
      expect(inputAfter).toHaveValue('José García (Ortodoncia)')
    })
  })

  describe('ARIA shape', () => {
    it('exposes role="combobox" and aria-autocomplete="list"', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).toHaveAttribute('role', 'combobox')
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
    })

    it('aria-expanded flips from false to true when the list opens', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).toHaveAttribute('aria-expanded', 'false')
      fireEvent.focus(input)
      expect(input).toHaveAttribute('aria-expanded', 'true')
    })

    it('aria-controls points at the rendered listbox id, and is absent while closed', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).not.toHaveAttribute('aria-controls')

      fireEvent.focus(input)
      const listbox = screen.getByRole('listbox')
      expect(input.getAttribute('aria-controls')).toBe(listbox.getAttribute('id'))
    })

    it('aria-activedescendant tracks the active option as ArrowDown moves, and is absent while closed', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).not.toHaveAttribute('aria-activedescendant')

      fireEvent.keyDown(input, { key: 'ArrowDown' })
      let options = screen.getAllByRole('option')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0].getAttribute('id'))

      fireEvent.keyDown(input, { key: 'ArrowDown' })
      options = screen.getAllByRole('option')
      expect(input.getAttribute('aria-activedescendant')).toBe(options[1].getAttribute('id'))
    })

    it('marks only the option matching the current value as aria-selected', () => {
      render(<DoctorPicker doctors={doctors} value="doc-2" onChange={vi.fn()} />)
      fireEvent.focus(getInput())

      const options = screen.getAllByRole('option')
      const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true')
      expect(selected).toHaveLength(1)
      expect(selected[0].textContent).toBe('Ana Muñoz (Endodoncia)')
    })

    it('every option carries role="option" inside a role="listbox" popup', () => {
      render(<DoctorPicker doctors={doctors} value="" onChange={vi.fn()} />)
      fireEvent.focus(getInput())
      const listbox = screen.getByRole('listbox')
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(3)
      options.forEach((option) => expect(listbox).toContainElement(option))
    })
  })

  describe('mouse selection', () => {
    it('calls onChange with the clicked option\'s id and closes the list', () => {
      const onChange = vi.fn()
      render(<DoctorPicker doctors={doctors} value="" onChange={onChange} />)
      fireEvent.focus(getInput())
      fireEvent.click(screen.getByRole('option', { name: 'Ana Muñoz (Endodoncia)' }))

      expect(onChange).toHaveBeenCalledWith('doc-2')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})
