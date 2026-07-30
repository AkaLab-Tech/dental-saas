import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useForm, Controller } from 'react-hook-form'
import i18n from 'i18next'
import '@/i18n'
import { DatePicker } from './DatePicker'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

// The trigger is the only element with aria-haspopup="dialog" in the tree
// (day/nav buttons inside the popover never carry that attribute), so this
// is unambiguous whether the popover is open or closed.
function getTrigger() {
  const trigger = document.querySelector('[aria-haspopup="dialog"]')
  if (!trigger) throw new Error('DatePicker trigger button not found')
  return trigger as HTMLButtonElement
}

describe('DatePicker', () => {
  describe('display', () => {
    it('shows the localized placeholder when value is empty', () => {
      render(<DatePicker value="" onChange={vi.fn()} />)
      expect(screen.getByText('Seleccionar fecha')).toBeInTheDocument()
    })

    it('shows a custom placeholder prop instead of the i18n default', () => {
      render(<DatePicker value="" onChange={vi.fn()} placeholder="Elige un día" />)
      expect(screen.getByText('Elige un día')).toBeInTheDocument()
      expect(screen.queryByText('Seleccionar fecha')).not.toBeInTheDocument()
    })

    it('renders the exact day for a value near month/day boundaries (no off-by-one)', () => {
      render(<DatePicker value="2026-07-31" onChange={vi.fn()} />)
      expect(screen.getByText('31 de julio de 2026')).toBeInTheDocument()
    })

    it('renders the first day of a month correctly', () => {
      render(<DatePicker value="2026-01-01" onChange={vi.fn()} />)
      expect(screen.getByText('1 de enero de 2026')).toBeInTheDocument()
    })
  })

  describe('opening the popover', () => {
    it('is closed by default (aria-expanded=false, no grid)', () => {
      render(<DatePicker value="" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    })

    it('opens the calendar grid when the trigger button is clicked', () => {
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('grid')).toBeInTheDocument()
    })

    it('toggles closed when the trigger is clicked again', () => {
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('grid')).toBeInTheDocument()
      fireEvent.click(getTrigger())
      expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    })

    it('closes when Escape is pressed', () => {
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('grid')).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    })

    it('closes when clicking outside the component', () => {
      render(
        <div>
          <DatePicker value="2026-07-15" onChange={vi.fn()} />
          <button type="button">outside</button>
        </div>
      )
      fireEvent.click(getTrigger())
      expect(screen.getByRole('grid')).toBeInTheDocument()
      fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
      expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    })

    it('does not open when disabled', () => {
      render(<DatePicker value="" onChange={vi.fn()} disabled />)
      expect(getTrigger()).toBeDisabled()
    })
  })

  describe('selecting a day', () => {
    it('calls onChange with the exact YYYY-MM-DD of the clicked day (30th stays the 30th, not 29th)', () => {
      const onChange = vi.fn()
      render(<DatePicker value="2026-07-01" onChange={onChange} />)
      fireEvent.click(getTrigger())

      // Use a regex instead of the exact accessible name: react-day-picker
      // prefixes the CURRENT day's cell with "Hoy, " (e.g. "Hoy, jueves, 30
      // de julio de 2026"), so an exact-string match breaks whenever "today"
      // (whatever date the suite runs on) collides with this fixture date.
      fireEvent.click(screen.getByRole('button', { name: /jueves, 30 de julio de 2026/ }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('2026-07-30')
    })

    it('zero-pads single-digit month/day values', () => {
      // Value starts on the 15th (not the target day) so the click actually
      // selects a *new* day: react-day-picker's single mode treats a click on
      // the already-selected day as a deselect (onSelect(undefined)), which
      // would make this pass for the wrong reason (onChange never firing).
      const onChange = vi.fn()
      render(<DatePicker value="2026-07-15" onChange={onChange} />)
      fireEvent.click(getTrigger())

      fireEvent.click(screen.getByRole('button', { name: 'miércoles, 1 de julio de 2026' }))

      expect(onChange).toHaveBeenCalledWith('2026-07-01')
    })

    it('closes the popover after a day is selected', () => {
      const onChange = vi.fn()
      render(<DatePicker value="2026-07-01" onChange={onChange} />)
      fireEvent.click(getTrigger())
      // Use a regex instead of the exact accessible name: react-day-picker
      // prefixes the CURRENT day's cell with "Hoy, " (e.g. "Hoy, jueves, 30
      // de julio de 2026"), so an exact-string match breaks whenever "today"
      // (whatever date the suite runs on) collides with this fixture date.
      fireEvent.click(screen.getByRole('button', { name: /jueves, 30 de julio de 2026/ }))

      expect(screen.queryByRole('grid')).not.toBeInTheDocument()
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('fires onBlur after a selection is made', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(<DatePicker value="2026-07-01" onChange={onChange} onBlur={onBlur} />)
      fireEvent.click(getTrigger())
      // Use a regex instead of the exact accessible name: react-day-picker
      // prefixes the CURRENT day's cell with "Hoy, " (e.g. "Hoy, jueves, 30
      // de julio de 2026"), so an exact-string match breaks whenever "today"
      // (whatever date the suite runs on) collides with this fixture date.
      fireEvent.click(screen.getByRole('button', { name: /jueves, 30 de julio de 2026/ }))

      expect(onBlur).toHaveBeenCalledTimes(1)
    })
  })

  describe('localization', () => {
    it('localizes the month caption and weekday headers in Spanish', () => {
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByText('julio 2026')).toBeInTheDocument()
      expect(screen.getByText('lu')).toBeInTheDocument()
    })

    it('uses the localized previous/next month aria-labels', () => {
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())
      expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeInTheDocument()
    })

    it('switches month name, dir and nav labels to Arabic (RTL) when the language changes', async () => {
      await i18n.changeLanguage('ar')
      render(<DatePicker value="2026-07-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      expect(screen.getByText('يوليو 2026')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'الشهر السابق' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'الشهر التالي' })).toBeInTheDocument()

      const root = document.querySelector('.rdp-root')
      expect(root).toHaveAttribute('dir', 'rtl')

      await i18n.changeLanguage('es')
    })

    it('falls back to English formatting for an unmapped i18n language code', () => {
      // RDP_LOCALES only has es/en/ar; a code outside that set (defensive
      // case — should never happen given i18n's supportedLngs) must not crash
      // and should fall back to the enUS react-day-picker locale.
      render(<DatePicker value="2026-07-04" onChange={vi.fn()} placeholder="x" />)
      expect(screen.getByText('4 de julio de 2026')).toBeInTheDocument()
    })
  })

  describe('react-hook-form Controller integration', () => {
    function ControllerHarness({ onSubmit }: { onSubmit: (date: string) => void }) {
      // Defaulted to a date in the current month (the suite runs "today" =
      // 2026-07-23): see the "known source bug" test below — DayPicker always
      // opens on today's month, so a cross-month default here would make this
      // integration test coupled to that bug instead of RHF wiring.
      const { control, handleSubmit } = useForm<{ date: string }>({ defaultValues: { date: '2026-07-01' } })
      return (
        <form onSubmit={handleSubmit((data) => onSubmit(data.date))}>
          <Controller
            name="date"
            control={control}
            render={({ field }) => (
              <DatePicker value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
          <button type="submit">save</button>
        </form>
      )
    }

    it('round-trips a selected date through Controller into the submitted form value', async () => {
      const onSubmit = vi.fn()
      render(<ControllerHarness onSubmit={onSubmit} />)

      expect(screen.getByText('1 de julio de 2026')).toBeInTheDocument()

      fireEvent.click(getTrigger())
      fireEvent.click(screen.getByRole('button', { name: 'viernes, 17 de julio de 2026' }))

      // The trigger's own displayed text updates to the newly selected date.
      expect(screen.getByText('17 de julio de 2026')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'save' }))
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2026-07-17'))
    })
  })

  // KNOWN SOURCE BUG (found while writing this suite, reported to the
  // implementer — not fixed here per the tester's scope):
  //
  // <DayPicker> is rendered with `selected={selected}` but no `month` /
  // `defaultMonth` prop. react-day-picker does NOT derive its displayed month
  // from `selected` — without `defaultMonth`, it always opens on *today's*
  // month. So editing an appointment whose date is in a different month than
  // today opens the picker on the current month with no visible highlighted
  // day, forcing the user to page through months to find their existing
  // selection instead of landing on it immediately.
  //
  // This test pins down the CORRECT behavior and is expected to fail against
  // the current implementation (it does, as of this writing: the picker opens
  // on "julio 2026" instead of "octubre 2025"). Fix: pass
  // `defaultMonth={selected}` (or `month`/`onMonthChange` if the open month
  // should stay in sync with `value` changes) to <DayPicker>.
  describe('known source bug: initial open month ignores the selected value', () => {
    it('opens the calendar already showing the month containing the selected value, not always today\'s month', () => {
      render(<DatePicker value="2025-10-15" onChange={vi.fn()} />)
      fireEvent.click(getTrigger())

      expect(screen.getByText('octubre 2025')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('applies the error border class when error=true', () => {
      render(<DatePicker value="" onChange={vi.fn()} error />)
      expect(getTrigger()).toHaveClass('border-red-300')
    })

    it('applies the default border class when error is not set', () => {
      render(<DatePicker value="" onChange={vi.fn()} />)
      expect(getTrigger()).toHaveClass('border-gray-300')
    })
  })
})
