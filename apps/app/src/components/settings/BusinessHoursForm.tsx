import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import type { TenantSettings, UpdateSettingsData } from '@/lib/settings-api'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

interface BusinessHoursFormProps {
  settings: TenantSettings | null
  canEdit: boolean
}

export function BusinessHoursForm({ settings, canEdit }: BusinessHoursFormProps) {
  const { t } = useTranslation()
  const { updateSettings, isSaving } = useSettingsStore()

  const DAYS_OF_WEEK = DAY_KEYS.map((dayKey, value) => ({
    value,
    label: t(`settings.days.${dayKey}`),
    short: t(`settings.days.${dayKey}Short`),
  }))

  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [businessHours, setBusinessHours] = useState<Record<string, { start: string; end: string }>>(
    {}
  )

  // Sync form data when settings load
  useEffect(() => {
    if (settings) {
      setWorkingDays(settings.workingDays || [1, 2, 3, 4, 5]) // eslint-disable-line react-hooks/set-state-in-effect
      setBusinessHours(settings.businessHours || {})
    }
  }, [settings])

  const toggleDay = (dayValue: number) => {
    if (!canEdit) return

    setWorkingDays((prev) => {
      if (prev.includes(dayValue)) {
        return prev.filter((d) => d !== dayValue)
      } else {
        return [...prev, dayValue].sort((a, b) => a - b)
      }
    })
  }

  const handleHoursChange = (dayKey: string, field: 'start' | 'end', value: string) => {
    if (!canEdit) return

    setBusinessHours((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [field]: value,
      },
    }))
  }

  const getDefaultHours = (dayKey: string) => {
    return businessHours[dayKey] || { start: '09:00', end: '18:00' }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return

    // Build businessHours only for working days
    const filteredBusinessHours: Record<string, { start: string; end: string }> = {}
    workingDays.forEach((dayValue) => {
      const dayKey = DAY_KEYS[dayValue]
      filteredBusinessHours[dayKey] = getDefaultHours(dayKey)
    })

    const data: UpdateSettingsData = {
      workingDays,
      businessHours: filteredBusinessHours,
    }

    await updateSettings(data)
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Read-only notice */}
      {!canEdit && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <Lock className="h-4 w-4" />
          {t('settings.businessHours.readOnlyNotice')}
        </div>
      )}

      {/* Working Days Section */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t('settings.businessHours.workingDays')}</h3>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings.businessHours.workingDaysHint')}
        </p>

        <div className="flex flex-wrap gap-2">
          {DAYS_OF_WEEK.map((day) => {
            const isActive = workingDays.includes(day.value)
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                disabled={!canEdit}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                } ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span className="hidden sm:inline">{day.label}</span>
                <span className="sm:hidden">{day.short}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Business Hours Section */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t('settings.businessHours.openingHours')}</h3>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings.businessHours.openingHoursHint')}
        </p>

        <div className="space-y-3">
          {DAYS_OF_WEEK.filter((day) => workingDays.includes(day.value)).map((day) => {
            const dayKey = DAY_KEYS[day.value]
            const hours = getDefaultHours(dayKey)

            return (
              <div
                key={day.value}
                className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
              >
                <span className="w-24 font-medium text-gray-700">{day.label}</span>

                <div className="flex items-center gap-2">
                  <label htmlFor={`${dayKey}-start`} className="sr-only">
                    {t('settings.businessHours.openingTime')}
                  </label>
                  <input
                    type="time"
                    id={`${dayKey}-start`}
                    value={hours.start}
                    onChange={(e) => handleHoursChange(dayKey, 'start', e.target.value)}
                    disabled={!canEdit}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <span className="text-gray-500">{t('settings.businessHours.timeSeparator')}</span>
                  <label htmlFor={`${dayKey}-end`} className="sr-only">
                    {t('settings.businessHours.closingTime')}
                  </label>
                  <input
                    type="time"
                    id={`${dayKey}-end`}
                    value={hours.end}
                    onChange={(e) => handleHoursChange(dayKey, 'end', e.target.value)}
                    disabled={!canEdit}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            )
          })}

          {workingDays.length === 0 && (
            <div className="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">
              {t('settings.businessHours.noWorkingDays')}
            </div>
          )}
        </div>
      </div>

      {/* Submit Button */}
      {canEdit && (
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('settings.saveChanges')}
          </button>
        </div>
      )}
    </form>
  )
}
