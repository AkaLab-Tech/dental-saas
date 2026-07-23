import { useState, useEffect } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings.store'
import type { TenantSettings, UpdateSettingsData } from '@/lib/settings-api'
import { languages, type LanguageCode } from '@/i18n'

const LANGUAGES = languages.map((l) => ({ value: l.code, label: l.nativeName }))

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2025)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2025)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2025-12-31)' },
]

const TIME_FORMAT_KEYS = [
  { value: '24h', labelKey: 'settings.timeFormats.24h', example: '(14:30)' },
  { value: '12h', labelKey: 'settings.timeFormats.12h', example: '(2:30 PM)' },
]

const DURATION_KEYS = [
  { value: 15, labelKey: 'settings.duration.15min' },
  { value: 30, labelKey: 'settings.duration.30min' },
  { value: 45, labelKey: 'settings.duration.45min' },
  { value: 60, labelKey: 'settings.duration.1h' },
  { value: 90, labelKey: 'settings.duration.1h30' },
  { value: 120, labelKey: 'settings.duration.2h' },
]

const REMINDER_KEYS = [
  { value: 1, labelKey: 'settings.reminder.1h' },
  { value: 2, labelKey: 'settings.reminder.2h' },
  { value: 4, labelKey: 'settings.reminder.4h' },
  { value: 12, labelKey: 'settings.reminder.12h' },
  { value: 24, labelKey: 'settings.reminder.24h' },
  { value: 48, labelKey: 'settings.reminder.48h' },
  { value: 72, labelKey: 'settings.reminder.72h' },
]

interface PreferencesFormProps {
  settings: TenantSettings | null
  canEdit: boolean
}

export function PreferencesForm({ settings, canEdit }: PreferencesFormProps) {
  const { updateSettings, isSaving } = useSettingsStore()
  const { i18n, t } = useTranslation()

  const [formData, setFormData] = useState<UpdateSettingsData>({
    language: 'es',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    defaultAppointmentDuration: 30,
    appointmentBuffer: 0,
    emailNotifications: true,
    smsNotifications: false,
    appointmentReminders: true,
    reminderHoursBefore: 24,
  })

  // Sync form data when settings load. Applying the saved language itself is
  // handled globally by useAccountLanguage (in AppLayout) — this effect only
  // mirrors settings into local form state.
  useEffect(() => {
    if (settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        language: settings.language,
        dateFormat: settings.dateFormat,
        timeFormat: settings.timeFormat,
        defaultAppointmentDuration: settings.defaultAppointmentDuration,
        appointmentBuffer: settings.appointmentBuffer,
        emailNotifications: settings.emailNotifications,
        smsNotifications: settings.smsNotifications,
        appointmentReminders: settings.appointmentReminders,
        reminderHoursBefore: settings.reminderHoursBefore,
      })
    }
  }, [settings])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked

    // If language changes, also update i18n
    if (name === 'language') {
      i18n.changeLanguage(value as LanguageCode)
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    await updateSettings(formData)
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
          {t('settings.readOnlyNotice')}
        </div>
      )}

      {/* Localization Section */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">{t('settings.localization')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Language */}
          <div>
            <label htmlFor="language" className="block text-sm font-medium text-gray-700">
              {t('settings.language')}
            </label>
            <select
              id="language"
              name="language"
              value={formData.language}
              onChange={handleChange}
              disabled={!canEdit}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Format */}
          <div>
            <label htmlFor="dateFormat" className="block text-sm font-medium text-gray-700">
              {t('settings.dateFormat')}
            </label>
            <select
              id="dateFormat"
              name="dateFormat"
              value={formData.dateFormat}
              onChange={handleChange}
              disabled={!canEdit}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {DATE_FORMATS.map((fmt) => (
                <option key={fmt.value} value={fmt.value}>
                  {fmt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Time Format */}
          <div>
            <label htmlFor="timeFormat" className="block text-sm font-medium text-gray-700">
              {t('settings.timeFormat')}
            </label>
            <select
              id="timeFormat"
              name="timeFormat"
              value={formData.timeFormat}
              onChange={handleChange}
              disabled={!canEdit}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {TIME_FORMAT_KEYS.map((fmt) => (
                <option key={fmt.value} value={fmt.value}>
                  {t(fmt.labelKey)} {fmt.example}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Appointments Section */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">{t('settings.appointmentsSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Default Duration */}
          <div>
            <label
              htmlFor="defaultAppointmentDuration"
              className="block text-sm font-medium text-gray-700"
            >
              {t('settings.defaultDuration')}
            </label>
            <select
              id="defaultAppointmentDuration"
              name="defaultAppointmentDuration"
              value={formData.defaultAppointmentDuration}
              onChange={handleChange}
              disabled={!canEdit}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {DURATION_KEYS.map((dur) => (
                <option key={dur.value} value={dur.value}>
                  {t(dur.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Buffer Between Appointments */}
          <div>
            <label
              htmlFor="appointmentBuffer"
              className="block text-sm font-medium text-gray-700"
            >
              {t('settings.bufferTime')}
            </label>
            <input
              type="number"
              id="appointmentBuffer"
              name="appointmentBuffer"
              value={formData.appointmentBuffer}
              onChange={handleChange}
              disabled={!canEdit}
              min={0}
              max={60}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('settings.bufferTimeHelp')}
            </p>
          </div>
        </div>
      </div>

      {/* Notifications Section */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">{t('settings.notifications')}</h3>
        <div className="space-y-4">
          {/* Email Notifications */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="emailNotifications"
              checked={formData.emailNotifications}
              onChange={handleChange}
              disabled={!canEdit}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-700">
              {t('settings.emailNotifications')}
            </span>
          </label>

          {/* SMS Notifications */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="smsNotifications"
              checked={formData.smsNotifications}
              onChange={handleChange}
              disabled={!canEdit}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-700">
              {t('settings.smsNotifications')}
            </span>
            <span className="text-xs text-gray-400">({t('settings.comingSoon')})</span>
          </label>

          {/* Appointment Reminders */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="appointmentReminders"
              checked={formData.appointmentReminders}
              onChange={handleChange}
              disabled={!canEdit}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-700">
              {t('settings.appointmentReminders')}
            </span>
          </label>

          {/* Reminder Hours */}
          {formData.appointmentReminders && (
            <div className="ml-7">
              <label
                htmlFor="reminderHoursBefore"
                className="block text-sm font-medium text-gray-700"
              >
                {t('settings.sendReminder')}
              </label>
              <select
                id="reminderHoursBefore"
                name="reminderHoursBefore"
                value={formData.reminderHoursBefore}
                onChange={handleChange}
                disabled={!canEdit}
                className="mt-1 block w-48 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                {REMINDER_KEYS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {t(h.labelKey)}
                  </option>
                ))}
              </select>
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
