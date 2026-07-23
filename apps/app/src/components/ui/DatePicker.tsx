import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { DayPicker } from 'react-day-picker'
import { es, enUS, ar } from 'react-day-picker/locale'
import { Calendar as CalendarIcon } from 'lucide-react'
import 'react-day-picker/style.css'

// Keyed by our app's i18n language codes (see src/i18n/index.ts `languages`).
const RDP_LOCALES = { es, en: enUS, ar } as const

// Blue accent matching the app's other inputs (focus:ring-blue-500 / bg-blue-600).
const RDP_ACCENT_STYLE = {
  '--rdp-accent-color': '#2563eb',
  '--rdp-accent-background-color': '#eff6ff',
} as CSSProperties

// Parse a 'YYYY-MM-DD' string as a LOCAL date (avoid `new Date(str)`, which
// parses as UTC midnight and can shift a day near midnight in some timezones).
function parseISODate(value: string): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface DatePickerProps {
  /** The selected date as a 'YYYY-MM-DD' string, matching the form's submitted format. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  id?: string
  disabled?: boolean
  error?: boolean
  placeholder?: string
  'aria-label'?: string
}

export function DatePicker({
  value,
  onChange,
  onBlur,
  id,
  disabled,
  error,
  placeholder,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const locale = RDP_LOCALES[i18n.language as keyof typeof RDP_LOCALES] ?? enUS
  const selected = parseISODate(value)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setIsOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleSelect = (date: Date | undefined) => {
    if (!date) return
    onChange(formatISODate(date))
    setIsOpen(false)
    onBlur?.()
  }

  const displayValue = selected
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }).format(selected)
    : ''

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        onBlur={() => {
          // Only fire RHF's onBlur when focus isn't moving into the popover.
          if (!isOpen) onBlur?.()
        }}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left text-sm disabled:bg-gray-100 disabled:cursor-not-allowed ${
          error ? 'border-red-300' : 'border-gray-300'
        }`}
      >
        <span className={displayValue ? 'text-gray-900' : 'text-gray-400'}>
          {displayValue || placeholder || t('dates.datePicker.placeholder')}
        </span>
        <CalendarIcon className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {isOpen && (
        <div
          className="absolute z-20 start-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
          style={RDP_ACCENT_STYLE}
        >
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={handleSelect}
            locale={locale}
            dir={i18n.dir()}
            labels={{
              labelPrevious: () => t('dates.datePicker.previousMonth'),
              labelNext: () => t('dates.datePicker.nextMonth'),
            }}
            autoFocus
          />
        </div>
      )}
    </div>
  )
}

export default DatePicker
