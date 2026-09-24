import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'

export interface DoctorOption {
  id: string
  firstName: string
  lastName: string
  specialty: string | null
}

export interface DoctorPickerProps {
  id?: string
  doctors: DoctorOption[]
  value: string
  onChange: (id: string) => void
  /**
   * Rendered when `value` points at a doctor missing from `doctors` (e.g. an
   * inactive doctor while editing) so the current selection stays visible
   * instead of silently dropping.
   */
  fallback?: DoctorOption | null
  disabled?: boolean
  loading?: boolean
  error?: string
  placeholder?: string
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
}

function formatDoctorLabel(doctor: DoctorOption): string {
  const name = `${doctor.firstName} ${doctor.lastName}`
  return doctor.specialty ? `${name} (${doctor.specialty})` : name
}

export function DoctorPicker({
  id,
  doctors,
  value,
  onChange,
  fallback,
  disabled,
  loading,
  error,
  placeholder,
}: DoctorPickerProps) {
  const { t } = useTranslation()
  const listboxId = useId()
  const errorId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedDoctor =
    doctors.find((doctor) => doctor.id === value) ||
    (fallback && fallback.id === value ? fallback : null)
  const selectedLabel = selectedDoctor ? formatDoctorLabel(selectedDoctor) : ''

  const [query, setQuery] = useState(selectedLabel)
  const [isFiltering, setIsFiltering] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Tracks the previous render's selectedLabel so an external `value` change
  // (e.g. reset() on edit-mount, or the doctors list resolving) can adjust
  // `query` during render instead of via a post-commit effect, without
  // clobbering an in-progress search.
  const [prevSelectedLabel, setPrevSelectedLabel] = useState(selectedLabel)

  if (selectedLabel !== prevSelectedLabel) {
    setPrevSelectedLabel(selectedLabel)
    if (!isFiltering) setQuery(selectedLabel)
  }

  const isDisabled = !!disabled || !!loading

  // Filtering is client-side over the already-loaded list: before the user
  // types anything the full list is shown (matches on focus/ArrowDown too).
  const filteredDoctors = useMemo(() => {
    if (!isFiltering) return doctors
    const needle = normalizeText(query.trim())
    if (!needle) return doctors
    return doctors.filter((doctor) => {
      const firstName = normalizeText(doctor.firstName)
      const lastName = normalizeText(doctor.lastName)
      const fullName = normalizeText(`${doctor.firstName} ${doctor.lastName}`)
      const specialty = doctor.specialty ? normalizeText(doctor.specialty) : ''
      return (
        firstName.includes(needle) ||
        lastName.includes(needle) ||
        fullName.includes(needle) ||
        (!!specialty && specialty.includes(needle))
      )
    })
  }, [doctors, query, isFiltering])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveIndex(-1)
        setIsFiltering(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    const option = listRef.current?.children[activeIndex] as HTMLElement | undefined
    // jsdom doesn't implement scrollIntoView.
    option?.scrollIntoView?.({ block: 'nearest' })
  }, [isOpen, activeIndex])

  const closeList = (revert: boolean) => {
    setIsOpen(false)
    setActiveIndex(-1)
    if (revert) {
      setIsFiltering(false)
      setQuery(selectedLabel)
    }
  }

  const handleSelect = (doctor: DoctorOption) => {
    setQuery(formatDoctorLabel(doctor))
    setIsFiltering(false)
    closeList(false)
    onChange(doctor.id)
  }

  const handleClear = () => {
    onChange('')
    setQuery('')
    setIsFiltering(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isDisabled) return

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIsOpen(true)
        setActiveIndex(filteredDoctors.length > 0 ? 0 : -1)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => (prev < filteredDoctors.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredDoctors.length - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < filteredDoctors.length) {
          handleSelect(filteredDoctors[activeIndex])
        }
        break
      case 'Escape':
        // Stop propagation so the host modal's own Escape handler (which
        // closes the whole modal) doesn't also fire.
        e.preventDefault()
        e.stopPropagation()
        closeList(true)
        break
      default:
        break
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          disabled={isDisabled}
          value={query}
          placeholder={placeholder ?? t('doctorPicker.placeholder')}
          onFocus={(e) => {
            setIsOpen(true)
            e.target.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsFiltering(true)
            setIsOpen(true)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            const nextFocusTarget = e.relatedTarget as Node | null
            if (nextFocusTarget && containerRef.current?.contains(nextFocusTarget)) return
            closeList(true)
          }}
          className={`w-full ps-3 pe-8 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-start disabled:bg-gray-100 disabled:cursor-not-allowed ${
            error ? 'border-red-300' : 'border-gray-300'
          }`}
        />
        <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
          {!loading && !!value && !isDisabled && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={t('doctorPicker.clear')}
              className="text-gray-400 hover:text-gray-600 p-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={placeholder ?? t('doctorPicker.placeholder')}
          className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto py-1"
          // Keeps focus on the input through a mouse selection, so no blur
          // fires ahead of the click (see the input's onBlur above).
          onMouseDown={(e) => e.preventDefault()}
        >
          {filteredDoctors.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-sm text-gray-500">
              {t('doctorPicker.noResults')}
            </li>
          ) : (
            filteredDoctors.map((doctor, index) => (
              <li
                key={doctor.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={doctor.id === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(doctor)}
                className={`px-3 py-1.5 text-sm text-start cursor-pointer ${
                  index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-50'
                }`}
              >
                {formatDoctorLabel(doctor)}
              </li>
            ))
          )}
        </ul>
      )}

      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export default DoctorPicker
