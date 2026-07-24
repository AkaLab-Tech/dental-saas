import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useForm, Controller } from 'react-hook-form'
import i18n from 'i18next'
import '@/i18n'
import { TimePicker } from './TimePicker'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

// Mirrors the production formatDisplayTime() (an Intl.DateTimeFormat call
// with { hour: '2-digit', minute: '2-digit' }) so assertions stay exact
// without hardcoding locale glyphs whose rendering can vary across ICU
// builds (notably Arabic AM/PM markers) — see the existing precedent for
// this pattern in AppointmentsPage.test.tsx ("Arabic ICU output differs per
// environment").
function formatExpected(language: string, hours: number, minutes: number): string {
  const date = new Date(2000, 0, 1, hours, minutes)
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date)
}

// The trigger is the only element with aria-haspopup="listbox" in the tree,
// so this is unambiguous whether the popover is open or closed.
function getTrigger() {
  const trigger = document.querySelector('[aria-haspopup="listbox"]')
  if (!trigger) throw new Error('TimePicker trigger button not found')
  return trigger as HTMLButtonElement
}

function getOptionByExactText(text: string) {
  return screen.getAllByRole('option').find((el) => el.textContent === text)
}

describe('TimePicker', () => {
  describe('display', () => {
    it('renders no native input[type="time"] anywhere in the output', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} aria-label="Hora" />)
      expect(document.querySelector('input[type="time"]')).not.toBeInTheDocument()
      expect(document.querySelector('input')).not.toBeInTheDocument()
    })

    it('shows the localized placeholder when value is empty', () => {
      render(<TimePicker value="" onChange={vi.fn()} />)
      expect(screen.getByText('Seleccionar hora')).toBeInTheDocument()
    })

    it('shows a custom placeholder prop instead of the i18n default', () => {
      render(<TimePicker value="" onChange={vi.fn()} placeholder="Elige una hora" />)
      expect(screen.getByText('Elige una hora')).toBeInTheDocument()
      expect(screen.queryByText('Seleccionar hora')).not.toBeInTheDocument()
    })

    it('displays the value formatted for the active (Spanish, 24h) locale', () => {
      render(<TimePicker value="14:35" onChange={vi.fn()} />)
      expect(screen.getByText('14:35')).toBeInTheDocument()
    })

    it('displays the value formatted for English (12h + AM/PM)', async () => {
      await i18n.changeLanguage('en')
      render(<TimePicker value="14:35" onChange={vi.fn()} />)
      expect(screen.getByText(formatExpected('en', 14, 35))).toBeInTheDocument()
      expect(screen.getByText(/PM/)).toBeInTheDocument()
      await i18n.changeLanguage('es')
    })

    it('displays the value formatted for Arabic using the active Intl locale', async () => {
      await i18n.changeLanguage('ar')
      render(<TimePicker value="09:05" onChange={vi.fn()} />)
      expect(screen.getByText(formatExpected('ar', 9, 5))).toBeInTheDocument()
      await i18n.changeLanguage('es')
    })
  })

  describe('opening the popover', () => {
    it('is closed by default (aria-expanded=false, no listbox)', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('opens the option list when the trigger button is clicked', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('toggles closed when the trigger is clicked again', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      fireEvent.click(getTrigger())
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('closes when Escape is pressed', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      fireEvent.keyDown(getTrigger(), { key: 'Escape' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('closes when clicking outside the component', () => {
      render(
        <div>
          <TimePicker value="09:00" onChange={vi.fn()} />
          <button type="button">outside</button>
        </div>
      )
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('does not open when disabled', () => {
      render(<TimePicker value="" onChange={vi.fn()} disabled />)
      expect(getTrigger()).toBeDisabled()
    })
  })

  // Regression coverage for task #347 review cycle 2: tabbing away from the
  // trigger while the popover was open used to leave the 96-option listbox
  // rendered with focus elsewhere, and RHF's onBlur never fired because the
  // old handler gated on `if (!isOpen)`. The fix drops that gate and instead
  // checks e.relatedTarget: focus landing inside the container is a no-op,
  // anything else closes the popover and always calls onBlur.
  //
  // jsdom does not simulate real Tab-triggered focus traversal via
  // fireEvent.keyDown, so these dispatch a native blur event with
  // relatedTarget set explicitly, mirroring what the browser does when Tab
  // moves focus to the next focusable element.
  describe('closing via blur (Tab away from the trigger)', () => {
    it('closes the popover, flips aria-expanded to false, and fires onBlur when focus moves outside the widget', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(
        <div>
          <TimePicker value="09:00" onChange={onChange} onBlur={onBlur} />
          <button type="button">next field</button>
        </div>
      )
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      fireEvent.blur(getTrigger(), { relatedTarget: screen.getByRole('button', { name: 'next field' }) })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(onBlur).toHaveBeenCalledTimes(1)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('fires onBlur exactly once even when the popover was already closed (no isOpen gate left)', () => {
      const onBlur = vi.fn()
      render(
        <div>
          <TimePicker value="09:00" onChange={vi.fn()} onBlur={onBlur} />
          <button type="button">next field</button>
        </div>
      )
      // Popover is closed (never opened) — this exercises the branch that
      // used to be gated on `if (!isOpen)` and silently swallowed onBlur.
      fireEvent.blur(getTrigger(), { relatedTarget: screen.getByRole('button', { name: 'next field' }) })

      expect(onBlur).toHaveBeenCalledTimes(1)
    })

    it('does not close or fire onBlur when the relatedTarget is still inside the widget', () => {
      const onBlur = vi.fn()
      render(<TimePicker value="09:00" onChange={vi.fn()} onBlur={onBlur} />)
      fireEvent.click(getTrigger())
      const listbox = screen.getByRole('listbox')

      fireEvent.blur(getTrigger(), { relatedTarget: listbox })

      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(onBlur).not.toHaveBeenCalled()
    })

    // Cross-check against the two behaviors this fix must not regress: a
    // mouse selection still fires onBlur exactly once (via commit(), not a
    // second time through this same handler — see "fires onBlur after a
    // selection is made" below, and Escape still never fires onBlur at all
    // because focus never leaves the trigger.
    it('does not fire onBlur when Escape closes the popover (focus stays on the trigger)', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} onBlur={onBlur} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'Escape' })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onBlur).not.toHaveBeenCalled()
    })
  })

  describe('slots', () => {
    it('renders 96 options at the default 15-minute step, from 00:00 to 23:45', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(96)
      expect(options[0].textContent).toBe('00:00')
      expect(options[95].textContent).toBe('23:45')
    })

    it('renders 48 options when minuteStep=30', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} minuteStep={30} />)
      fireEvent.click(getTrigger())
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(48)
      expect(options[1].textContent).toBe('00:30')
    })

    it('injects an off-step existing value in sorted position and marks it selected, without duplicating or replacing it', () => {
      render(<TimePicker value="14:37" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(97)

      const selected = getOptionByExactText('14:37')
      expect(selected).toBeDefined()
      expect(selected).toHaveAttribute('aria-selected', 'true')

      // Neighboring on-step slots are still present, unaltered.
      const texts = options.map((o) => o.textContent)
      const index = texts.indexOf('14:37')
      expect(texts[index - 1]).toBe('14:30')
      expect(texts[index + 1]).toBe('14:45')
    })

    it('does not duplicate the value when it already falls on-step', () => {
      render(<TimePicker value="14:30" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      const options = screen.getAllByRole('option').filter((o) => o.textContent === '14:30')
      expect(options).toHaveLength(1)
    })
  })

  describe('selecting a time with the mouse', () => {
    it('calls onChange with the exact HH:mm of the clicked option', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())

      fireEvent.click(getOptionByExactText('10:30')!)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('10:30')
    })

    it('closes the popover after a time is selected', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.click(getOptionByExactText('10:30')!)

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('fires onBlur after a selection is made', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} onBlur={onBlur} />)
      fireEvent.click(getTrigger())
      fireEvent.click(getOptionByExactText('10:30')!)

      expect(onBlur).toHaveBeenCalledTimes(1)
    })

    it('preserves an off-step value unless a different option is clicked', () => {
      const onChange = vi.fn()
      render(<TimePicker value="14:37" onChange={onChange} />)
      fireEvent.click(getTrigger())
      // Re-clicking the trigger to close without picking anything else must
      // not have invoked onChange.
      fireEvent.click(getTrigger())
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByText('14:37')).toBeInTheDocument()
    })
  })

  describe('keyboard navigation', () => {
    it('opens a closed popover on ArrowDown without moving off the current selection yet', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.keyDown(getTrigger(), { key: 'ArrowDown' })

      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
      const selected = getOptionByExactText('09:00')
      expect(selected).toHaveAttribute('aria-selected', 'true')
      const controlsId = getTrigger().getAttribute('aria-controls')
      expect(controlsId).toBeTruthy()
      expect(document.getElementById(controlsId as string)).toBeInTheDocument()
    })

    it('opens a closed popover on ArrowUp', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.keyDown(getTrigger(), { key: 'ArrowUp' })
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens a closed popover on Enter', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens a closed popover on Space', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.keyDown(getTrigger(), { key: ' ' })
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    })

    it('ArrowDown moves the active option one 15-minute slot forward and Enter commits it', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'ArrowDown' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('09:15')
    })

    it('ArrowUp moves the active option one 15-minute slot backward and Space commits it', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'ArrowUp' })
      fireEvent.keyDown(getTrigger(), { key: ' ' })

      expect(onChange).toHaveBeenCalledWith('08:45')
    })

    it('PageDown moves the active option a full hour forward (4 slots at the default step)', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'PageDown' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('10:00')
    })

    it('PageUp moves the active option a full hour backward', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'PageUp' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('08:00')
    })

    it('PageDown moves a full hour worth of slots at a non-default minuteStep too', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} minuteStep={30} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'PageDown' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('10:00')
    })

    it('Home jumps to the first slot (00:00)', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'Home' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('00:00')
    })

    it('End jumps to the last slot (23:45)', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'End' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('23:45')
    })

    it('does not move past the last slot on ArrowDown at End', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'End' })
      fireEvent.keyDown(getTrigger(), { key: 'ArrowDown' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('23:45')
    })

    it('does not move before the first slot on ArrowUp at Home', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'Home' })
      fireEvent.keyDown(getTrigger(), { key: 'ArrowUp' })
      fireEvent.keyDown(getTrigger(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('00:00')
    })

    it('Escape closes the popover without committing a change', () => {
      const onChange = vi.fn()
      render(<TimePicker value="09:00" onChange={onChange} />)
      fireEvent.click(getTrigger())
      fireEvent.keyDown(getTrigger(), { key: 'ArrowDown' })
      fireEvent.keyDown(getTrigger(), { key: 'Escape' })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('ARIA wiring', () => {
    it('exposes aria-haspopup="listbox" and toggles aria-expanded', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveAttribute('aria-haspopup', 'listbox')
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(getTrigger())
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    })

    // Regression guard for task #347 review cycle 1: the trigger is a
    // <button>, which WAI-ARIA does not permit to carry
    // aria-activedescendant under its implicit role="button" — screen
    // readers ignored the attribute entirely. role="combobox" is the
    // ARIA-in-HTML-sanctioned role for <button> and matches the APG
    // select-only-combobox pattern this widget implements, so
    // aria-activedescendant is announced correctly while arrowing through
    // options.
    it('exposes role="combobox" on the trigger so aria-activedescendant is valid', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveAttribute('role', 'combobox')
    })

    it('wires aria-controls to the open listbox and aria-activedescendant to the active option', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      const controlsId = getTrigger().getAttribute('aria-controls')
      const listbox = screen.getByRole('listbox')
      expect(listbox).toHaveAttribute('id', controlsId)

      const activeId = getTrigger().getAttribute('aria-activedescendant')
      expect(activeId).toBeTruthy()
      const activeOption = document.getElementById(activeId as string)
      expect(activeOption).toBeInTheDocument()
      expect(activeOption).toHaveAttribute('role', 'option')
      expect(activeOption?.textContent).toBe('09:00')
    })

    it('does not expose aria-controls or aria-activedescendant while closed', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      expect(getTrigger()).not.toHaveAttribute('aria-controls')
      expect(getTrigger()).not.toHaveAttribute('aria-activedescendant')
    })

    it('marks only the currently selected option as aria-selected', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')
      expect(selected).toHaveLength(1)
      expect(selected[0].textContent).toBe('09:00')
    })

    it('applies the caller aria-label to both the trigger and the listbox', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} aria-label="Hora de inicio" />)
      expect(getTrigger()).toHaveAttribute('aria-label', 'Hora de inicio')
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Hora de inicio')
    })

    it('falls back to the i18n label for the listbox when no aria-label is given', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Hora')
    })
  })

  describe('RTL and logical CSS', () => {
    it('uses only logical (RTL-safe) utility classes, never physical left/right/pl-/pr- ones', () => {
      const { container } = render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      expect(container.innerHTML).not.toMatch(/\bpl-\d/)
      expect(container.innerHTML).not.toMatch(/\bpr-\d/)
      expect(container.innerHTML).not.toMatch(/\bleft-\d/)
      expect(container.innerHTML).not.toMatch(/\bright-\d/)
    })

    it("the popover inherits the active language's direction (rtl for Arabic)", async () => {
      await i18n.changeLanguage('ar')
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      const popover = document.querySelector('[dir]')
      expect(popover).toHaveAttribute('dir', 'rtl')
      await i18n.changeLanguage('es')
    })

    it('the popover direction is ltr for Spanish', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      const popover = document.querySelector('[dir]')
      expect(popover).toHaveAttribute('dir', 'ltr')
    })
  })

  describe('locale keys', () => {
    it('has the new dates.timePicker placeholder/label keys in all three locales', async () => {
      const cases: Array<[string, string, string]> = [
        ['es', 'Seleccionar hora', 'Hora'],
        ['en', 'Select time', 'Time'],
        ['ar', 'اختر الوقت', 'الوقت'],
      ]
      for (const [lang, placeholder, label] of cases) {
        await i18n.changeLanguage(lang)
        expect(i18n.t('dates.timePicker.placeholder')).toBe(placeholder)
        expect(i18n.t('dates.timePicker.label')).toBe(label)
      }
      await i18n.changeLanguage('es')
    })
  })

  describe('error state', () => {
    it('applies the error border class when error=true', () => {
      render(<TimePicker value="" onChange={vi.fn()} error />)
      expect(getTrigger()).toHaveClass('border-red-300')
    })

    it('applies the default border class when error is not set', () => {
      render(<TimePicker value="" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveClass('border-gray-300')
    })
  })

  describe('disabled state', () => {
    it('forwards disabled to the trigger button', () => {
      render(<TimePicker value="09:00" onChange={vi.fn()} disabled />)
      expect(getTrigger()).toBeDisabled()
    })
  })

  describe('react-hook-form Controller integration', () => {
    function ControllerHarness({ onSubmit }: { onSubmit: (time: string) => void }) {
      const { control, handleSubmit } = useForm<{ time: string }>({ defaultValues: { time: '09:00' } })
      return (
        <form onSubmit={handleSubmit((data) => onSubmit(data.time))}>
          <Controller
            name="time"
            control={control}
            render={({ field }) => (
              <TimePicker value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
          <button type="submit">save</button>
        </form>
      )
    }

    it('round-trips a selected time through Controller into the submitted form value', async () => {
      const onSubmit = vi.fn()
      render(<ControllerHarness onSubmit={onSubmit} />)

      expect(screen.getByText('09:00')).toBeInTheDocument()

      fireEvent.click(getTrigger())
      fireEvent.click(getOptionByExactText('16:15')!)

      // The trigger's own displayed text updates to the newly selected time.
      expect(screen.getByText('16:15')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'save' }))
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('16:15'))
    })

    function ErrorDisabledHarness({ error, disabled }: { error?: boolean; disabled?: boolean }) {
      const { control } = useForm<{ time: string }>({ defaultValues: { time: '09:00' } })
      return (
        <Controller
          name="time"
          control={control}
          render={({ field }) => (
            <TimePicker
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={error}
              disabled={disabled}
            />
          )}
        />
      )
    }

    it('forwards error and disabled through the Controller-driven field', () => {
      render(<ErrorDisabledHarness error disabled />)
      expect(getTrigger()).toHaveClass('border-red-300')
      expect(getTrigger()).toBeDisabled()
    })
  })
})
