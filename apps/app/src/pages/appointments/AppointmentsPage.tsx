import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, AlertCircle, Calendar, Loader2, X, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { useAppointmentsStore } from '@/stores/appointments.store'
import { AppointmentCard } from '@/components/appointments/AppointmentCard'
import { AppointmentFormModal } from '@/components/appointments/AppointmentFormModal'
import { AppointmentCompleteModal } from '@/components/appointments/AppointmentCompleteModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Appointment, CreateAppointmentData, UpdateAppointmentData, AppointmentStatus } from '@/lib/appointment-api'
import { getStatusLabel } from '@/lib/appointment-api'

const STATUS_OPTIONS: AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]

export function AppointmentsPage() {
  const { t, i18n } = useTranslation()
  const {
    appointments,
    stats,
    isLoading,
    error,
    selectedDoctorId,
    selectedStatus,
    showInactive,
    currentDate,
    fetchAppointments,
    fetchStats,
    addAppointment,
    editAppointment,
    removeAppointment,
    restoreDeletedAppointment,
    setSelectedDoctorId,
    setSelectedStatus,
    setShowInactive,
    setCurrentDate,
    clearError,
  } = useAppointmentsStore()

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [appointmentToDelete, setAppointmentToDelete] = useState<Appointment | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [appointmentToComplete, setAppointmentToComplete] = useState<Appointment | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Calculate date range for current week/month view
  const dateRange = useMemo(() => {
    const start = new Date(currentDate)
    start.setDate(1) // Start of month
    start.setHours(0, 0, 0, 0)

    // Derive from `start` (day 1): month arithmetic on day 29-31 overflows
    // into the wrong month (e.g. May 31 + 1 month = July 1)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    end.setDate(0) // Last day of month
    end.setHours(23, 59, 59, 999)

    return {
      from: start.toISOString(),
      to: end.toISOString(),
    }
  }, [currentDate])

  // Fetch appointments on mount and when filters change
  useEffect(() => {
    fetchAppointments({
      from: dateRange.from,
      to: dateRange.to,
    })
    fetchStats({
      from: dateRange.from,
      to: dateRange.to,
    })
  }, [dateRange, selectedDoctorId, selectedStatus, showInactive, fetchAppointments, fetchStats])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  // Clear local error after 5 seconds
  useEffect(() => {
    if (localError) {
      const timer = setTimeout(() => setLocalError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [localError])

  const handlePreviousMonth = () => {
    const newDate = new Date(currentDate)
    // Normalize to day 1 first: setMonth on day 29-31 overflows into the
    // wrong month (e.g. July 31 - 1 month = "June 31" = July 1)
    newDate.setDate(1)
    newDate.setMonth(newDate.getMonth() - 1)
    setCurrentDate(newDate)
  }

  const handleNextMonth = () => {
    const newDate = new Date(currentDate)
    newDate.setDate(1)
    newDate.setMonth(newDate.getMonth() + 1)
    setCurrentDate(newDate)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  const handleOpenCreate = () => {
    setSelectedAppointment(null)
    clearError()
    setIsFormOpen(true)
  }

  const handleEdit = (appointment: Appointment) => {
    setSelectedAppointment(appointment)
    clearError()
    setIsFormOpen(true)
  }

  const handleDelete = (appointment: Appointment) => {
    setAppointmentToDelete(appointment)
  }

  const handleRestore = async (appointment: Appointment) => {
    try {
      await restoreDeletedAppointment(appointment.id)
      setSuccessMessage(t('appointments.appointmentRestored'))
    } catch {
      // Error is handled by store
    }
  }

  const handleComplete = (appointment: Appointment) => {
    setAppointmentToComplete(appointment)
  }

  const handleFormSubmit = useCallback(
    async (data: CreateAppointmentData | UpdateAppointmentData) => {
      try {
        if (selectedAppointment) {
          await editAppointment(selectedAppointment.id, data as UpdateAppointmentData)
          setSuccessMessage(t('appointments.appointmentUpdated'))
        } else {
          await addAppointment(data as CreateAppointmentData)
          setSuccessMessage(t('appointments.appointmentCreated'))
        }
        setIsFormOpen(false)
        setSelectedAppointment(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedAppointment, addAppointment, editAppointment, t]
  )

  const handleConfirmDelete = async () => {
    if (!appointmentToDelete) return
    setIsDeleting(true)
    try {
      await removeAppointment(appointmentToDelete.id)
      setSuccessMessage(t('appointments.appointmentCancelled'))
      setAppointmentToDelete(null)
    } catch {
      // Error is handled by store
    } finally {
      setIsDeleting(false)
    }
  }

  // Group appointments by date
  const groupedAppointments = useMemo(() => {
    const groups: Record<string, Appointment[]> = {}
    appointments.forEach((apt) => {
      const dateKey = new Date(apt.startTime).toDateString()
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(apt)
    })

    // Sort each group by time
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    })

    // Sort dates
    const sortedKeys = Object.keys(groups).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    )

    return sortedKeys.map((key) => ({
      date: key,
      appointments: groups[key],
    }))
  }, [appointments])

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })
  }

  const formatDateHeader = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.toDateString() === today.toDateString()) {
      return t('common.today')
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return t('dates.tomorrow')
    }
    return date.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('appointments.title')}</h1>
          <p className="text-gray-600 mt-1">
            {t('appointments.subtitle')}
            {stats && (
              <span className="text-gray-500 ml-1">
                ({stats.scheduled} {t('appointments.scheduled')}, {stats.completed} {t('appointments.completed')})
              </span>
            )}
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-5 w-5" />
          {t('appointments.newAppointment')}
        </button>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          {successMessage}
        </div>
      )}

      {/* Error message */}
      {(error || localError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-800">{error || localError}</p>
          </div>
          <button
            onClick={() => {
              if (error) clearError()
              if (localError) setLocalError(null)
            }}
            className="text-red-500 hover:text-red-700 p-1"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Calendar Navigation */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviousMonth}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label={t('appointments.previousMonth')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900 min-w-[200px] text-center first-letter:uppercase">
              {formatMonthYear(currentDate)}
            </h2>

            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label={t('appointments.nextMonth')}
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <button
              onClick={handleToday}
              className="ml-2 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              {t('common.today')}
            </button>
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors ${
              showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            {t('common.filter')}
            {(selectedDoctorId || selectedStatus || showInactive) && (
              <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {[selectedDoctorId, selectedStatus, showInactive].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('appointments.statusLabel')}</label>
              <select
                value={selectedStatus || ''}
                onChange={(e) => setSelectedStatus((e.target.value as AppointmentStatus) || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{t('appointments.allStatuses')}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {getStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                {t('appointments.showCancelled')}
              </label>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => {
                  setSelectedDoctorId(null)
                  setSelectedStatus(null)
                  setShowInactive(false)
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {t('common.clearFilters')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && appointments.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && appointments.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <Calendar className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">
            {t('appointments.noAppointments')}
          </h3>
          <p className="text-gray-600 mt-1">
            {t('appointments.noAppointmentsInMonth', { month: formatMonthYear(currentDate) })}
          </p>
          <button
            onClick={handleOpenCreate}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            {t('appointments.addAppointment')}
          </button>
        </div>
      )}

      {/* Appointments list grouped by date */}
      {groupedAppointments.length > 0 && (
        <div className="space-y-6">
          {groupedAppointments.map(({ date, appointments: dayAppointments }) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-gray-500 first-letter:uppercase tracking-wide mb-3">
                {formatDateHeader(date)}
              </h3>
              <div className="space-y-3">
                {dayAppointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onRestore={handleRestore}
                    onComplete={handleComplete}
                    onError={setLocalError}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      <AppointmentFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setSelectedAppointment(null)
          clearError()
        }}
        onSubmit={handleFormSubmit}
        appointment={selectedAppointment}
        isLoading={isLoading}
        error={error}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!appointmentToDelete}
        onClose={() => setAppointmentToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('appointments.cancelAppointment')}
        message={t('appointments.confirmCancel')}
        confirmText={t('appointments.cancelAppointment')}
        cancelText={t('appointments.keep')}
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Complete Confirmation */}
      <AppointmentCompleteModal
        isOpen={!!appointmentToComplete}
        appointmentId={appointmentToComplete?.id ?? null}
        onClose={() => setAppointmentToComplete(null)}
        onCompleted={() => {
          setSuccessMessage(t('appointments.appointmentCompleted'))
          setAppointmentToComplete(null)
        }}
      />
    </div>
  )
}

export default AppointmentsPage
