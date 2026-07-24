import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'

const DEFAULT_MINUTE_STEP = 15
const MINUTES_PER_DAY = 24 * 60

function parseTimeValue(value: string): { hours: number; minutes: number } | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

function formatTimeValue(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// Every `minuteStep` slot from 00:00 to 23:45 (or wherever the step lands),
// plus the current value injected in sorted position if it falls off-step
// (e.g. an existing appointment's `14:37`) so opening the picker never
// silently rewrites it.
function buildSlots(minuteStep: number, value: string): string[] {
  const slots: string[] = []
  for (let total = 0; total < MINUTES_PER_DAY; total += minuteStep) {
    slots.push(formatTimeValue(Math.floor(total / 60), total % 60))
  }
  if (parseTimeValue(value) && !slots.includes(value)) {
    slots.push(value)
    slots.sort()
  }
  return slots
}

// 'HH:mm' strings sort and compare lexicographically same as chronologically,
// so a plain Date is only needed to hand off to Intl for localized display.
function formatDisplayTime(value: string, language: string): string {
  const parsed = parseTimeValue(value)
  if (!parsed) return ''
  const date = new Date(2000, 0, 1, parsed.hours, parsed.minutes)
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export interface TimePickerProps {
  /** The selected time as an 'HH:mm' 24-hour string, matching the form's submitted format. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  id?: string
  disabled?: boolean
  error?: boolean
  placeholder?: string
  'aria-label'?: string
  /** Step, in minutes, between selectable slots. Defaults to 15. */
  minuteStep?: number
}

export function TimePicker({
  value,
  onChange,
  onBlur,
  id,
  disabled,
  error,
  placeholder,
  'aria-label': ariaLabel,
  minuteStep = DEFAULT_MINUTE_STEP,
}: TimePickerProps) {
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listboxId = useId()

  const slots = useMemo(() => buildSlots(minuteStep, value), [minuteStep, value])
  const selectedIndex = value ? slots.indexOf(value) : -1

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
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    // Only re-sync the active option when the popover transitions open; once
    // open, arrow-key navigation owns activeIndex until it closes again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const option = listRef.current?.children[activeIndex] as HTMLElement | undefined
    // jsdom doesn't implement scrollIntoView.
    option?.scrollIntoView?.({ block: 'nearest' })
  }, [isOpen, activeIndex])

  const commit = (index: number) => {
    const next = slots[index]
    if (next === undefined) return
    onChange(next)
    setIsOpen(false)
    onBlur?.()
  }

  const pageSize = Math.max(1, Math.round(60 / minuteStep))

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, slots.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'PageDown':
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + pageSize, slots.length - 1))
        break
      case 'PageUp':
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - pageSize, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(slots.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
        break
      default:
        break
    }
  }

  const displayValue = formatDisplayTime(value, i18n.language)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Only fire RHF's onBlur when focus isn't moving into the popover.
          if (!isOpen) onBlur?.()
        }}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left text-sm disabled:bg-gray-100 disabled:cursor-not-allowed ${
          error ? 'border-red-300' : 'border-gray-300'
        }`}
      >
        <span className={displayValue ? 'text-gray-900' : 'text-gray-400'}>
          {displayValue || placeholder || t('dates.timePicker.placeholder')}
        </span>
        <Clock className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {isOpen && (
        <div
          className="absolute z-20 start-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg"
          dir={i18n.dir()}
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || t('dates.timePicker.label')}
            className="max-h-56 overflow-y-auto py-1"
          >
            {slots.map((slot, index) => (
              <li
                key={slot}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={slot === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`px-3 py-1.5 text-sm cursor-pointer ${
                  index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-50'
                }`}
              >
                {formatDisplayTime(slot, i18n.language)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default TimePicker
