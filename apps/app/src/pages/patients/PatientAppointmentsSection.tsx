import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock,
  Stethoscope,
  MoreVertical,
  Edit,
  Trash2,
  CheckCircle,
  FileText,
  Loader2,
  Undo2,
} from 'lucide-react'
import { Permission } from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import {
  type Appointment,
  type AppointmentStatus,
  getAppointmentsByPatient,
  deleteAppointment,
  getStatusBadgeClasses,
  formatTimeRange,
  getAppointmentDoctorName,
  getStatusI18nKey,
} from '@/lib/appointment-api'
import { AppointmentCompleteModal } from '@/components/appointments/AppointmentCompleteModal'
import { downloadAppointmentPdf } from '@/lib/pdf-api'
import { deletePayment } from '@/lib/payment-api'
import { formatCurrency } from '@/lib/format'
import i18n from '@/i18n'

// ============================================================================
// Types
// ============================================================================

interface PatientAppointmentsSectionProps {
  patientId: string
  onNewAppointment: () => void
  onEditAppointment: (appointment: Appointment) => void
  refreshKey?: number
  onPaymentsChange?: () => void
}

type FilterPeriod = 'upcoming' | 'past' | 'all'

// ============================================================================
// PatientAppointmentCard
// ============================================================================

function PatientAppointmentCard({
  appointment,
  onEdit,
  onComplete,
  onCancel,
  onError,
  onPaymentReversed,
}: {
  appointment: Appointment
  onEdit: (a: Appointment) => void
  onComplete: (a: Appointment) => void
  onCancel: (a: Appointment) => void
  onError?: (msg: string) => void
  onPaymentReversed: () => void
}) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const [showMenu, setShowMenu] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isReversingPayment, setIsReversingPayment] = useState(false)
  const [menuPos, setMenuPos] = useState<CSSProperties>({})
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(event.target as Node) &&
        btnRef.current && !btnRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isPast = new Date(appointment.endTime) < new Date()
  const isInactive = !appointment.isActive
  const canComplete = appointment.isActive &&
    !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)

  const startDate = new Date(appointment.startTime)
  const day = startDate.getDate()
  const month = startDate.toLocaleDateString(i18n.language, { month: 'short' })
  const year = startDate.getFullYear()
  const currentYear = new Date().getFullYear()

  return (
    <div
      className={`relative flex-shrink-0 w-52 bg-white border rounded-lg p-3 ${
        isInactive
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : isPast
            ? 'border-gray-200 opacity-75'
            : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
      } transition-all`}
    >
      {/* Actions menu */}
      {!isInactive && (
        <div className="absolute top-2 right-2">
          <button
            ref={btnRef}
            onClick={() => {
              if (!showMenu && btnRef.current) {
                const rect = btnRef.current.getBoundingClientRect()
                setMenuPos({
                  position: 'fixed',
                  top: rect.bottom + 4,
                  right: window.innerWidth - rect.right,
                })
              }
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            aria-label={t('common.options')}
          >
            <MoreVertical className="h-4 w-4 text-gray-400" />
          </button>
          {showMenu && createPortal(
            <div
              ref={menuRef}
              style={menuPos}
              className="w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1"
            >
              <button
                onClick={() => { onEdit(appointment); setShowMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Edit className="h-3.5 w-3.5" />
                {t('common.edit')}
              </button>
              <button
                onClick={async () => {
                  setIsDownloadingPdf(true)
                  try {
                    await downloadAppointmentPdf(appointment.id)
                  } catch (e) {
                    onError?.(e instanceof Error ? e.message : 'Error')
                  } finally {
                    setIsDownloadingPdf(false)
                    setShowMenu(false)
                  }
                }}
                disabled={isDownloadingPdf}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isDownloadingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {t('appointments.downloadPdf')}
              </button>
              {canComplete && (
                <button
                  onClick={() => { onComplete(appointment); setShowMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-green-700 hover:bg-green-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('appointments.markCompleted')}
                </button>
              )}
              <button
                onClick={() => { onCancel(appointment); setShowMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('appointments.cancelAppointment')}
              </button>
              {appointment.hasRecordedPayment && can(Permission.PAYMENTS_DELETE) && (
                <button
                  onClick={async () => {
                    if (!appointment.recordedPaymentId) return
                    if (!confirm(t('payments.reverseConsultationConfirm'))) return
                    setIsReversingPayment(true)
                    try {
                      await deletePayment(appointment.patientId, appointment.recordedPaymentId)
                      onPaymentReversed()
                    } catch (e) {
                      onError?.(e instanceof Error ? e.message : 'Error')
                    } finally {
                      setIsReversingPayment(false)
                      setShowMenu(false)
                    }
                  }}
                  disabled={isReversingPayment}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {isReversingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  {t('payments.reverseConsultationPayment')}
                </button>
              )}
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Date */}
      <div className="mb-2">
        <span className="text-2xl font-bold text-gray-900">{day}</span>
        <span className="text-sm text-gray-500 ml-1 capitalize">{month}</span>
        {year !== currentYear && (
          <span className="text-xs text-gray-400 ml-1">{year}</span>
        )}
      </div>

      {/* Time */}
      <div className="flex items-center gap-1 text-xs text-gray-600 mb-2">
        <Clock className="h-3 w-3 text-gray-400" />
        {formatTimeRange(appointment.startTime, appointment.endTime)}
      </div>

      {/* Status badge */}
      <div className="mb-2">
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(appointment.status)}`}>
          {t(`appointments.status.${getStatusI18nKey(appointment.status)}`)}
        </span>
      </div>

      {/* Type */}
      {appointment.type && (
        <p className="text-xs text-gray-600 mb-1 truncate">{appointment.type}</p>
      )}

      {/* Doctor */}
      <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
        <Stethoscope className="h-3 w-3 text-gray-400 shrink-0" />
        <span className="truncate">{getAppointmentDoctorName(appointment)}</span>
      </div>

      {/* Cost + payment breakdown (paid / partial / pending) */}
      {appointment.cost !== null && (() => {
        const cost = appointment.cost!
        const paidAmount = appointment.paidAmount ?? (appointment.isPaid ? cost : 0)
        const isFullyPaid = appointment.isPaid
        const isPartial = !isFullyPaid && paidAmount > 0
        const colorMain = isFullyPaid
          ? 'text-green-600'
          : isPartial
            ? 'text-blue-600'
            : 'text-amber-600'
        const colorTag = isFullyPaid
          ? 'text-green-500'
          : isPartial
            ? 'text-blue-500'
            : 'text-amber-500'

        return (
          <div className="mt-2 text-xs">
            <div className="flex items-center gap-1 flex-wrap">
              <span className={colorMain}>{formatCurrency(cost, currency)}</span>
              <span className={colorTag}>
                {isFullyPaid
                  ? `(${t('payment.paid')})`
                  : isPartial
                    ? `(${t('payment.partial')})`
                    : `(${t('payment.pending')})`}
              </span>
            </div>
            {isPartial && (
              <div className="mt-0.5 text-[11px] text-gray-500">
                {t('payment.appliedOf', {
                  paid: formatCurrency(paidAmount, currency),
                  total: formatCurrency(cost, currency),
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Reversible share of the paid figure (kind=APPOINTMENT payment recorded on
          this appointment). Shown only in the mixed case — a consultation payment
          plus older pool/advance money both covering this appointment — where the
          cost/paid breakdown above and the amount the reversal button would undo
          genuinely differ. When they're equal, this line would just repeat the
          figure already shown above. */}
      {appointment.hasRecordedPayment &&
        (appointment.recordedPaidAmount ?? 0) < (appointment.paidAmount ?? 0) && (
          <div className="mt-1 text-[11px] text-gray-500">
            {t('payments.consultationPayment')}: {formatCurrency(appointment.recordedPaidAmount ?? 0, currency)}
          </div>
        )}
    </div>
  )
}

// ============================================================================
// Main Section Component
// ============================================================================

export function PatientAppointmentsSection({
  patientId,
  onNewAppointment,
  onEditAppointment,
  refreshKey = 0,
  onPaymentsChange,
}: PatientAppointmentsSectionProps) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  // Collapse state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('patient-appointments-collapsed') !== 'false'
    } catch {
      return true
    }
  })

  // Data state
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('upcoming')
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | ''>('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)

  // Confirmation state
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel'; appointment: Appointment } | null>(null)
  const [isActioning, setIsActioning] = useState(false)
  const [appointmentToComplete, setAppointmentToComplete] = useState<Appointment | null>(null)

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('patient-appointments-collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Fetch appointments
  const fetchAppointments = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getAppointmentsByPatient(patientId, {
        limit: 100,
        includeInactive: true,
      })
      setAppointments(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading appointments')
    } finally {
      setIsLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments, refreshKey])

  // Filter and sort appointments
  const now = new Date()
  const filteredAppointments = appointments.filter(a => {
    // Period filter
    const startTime = new Date(a.startTime)
    if (filterPeriod === 'upcoming') {
      if (startTime < now && !isToday(startTime)) return false
    } else if (filterPeriod === 'past') {
      if (startTime >= now || isToday(startTime)) return false
    }

    // Cancelled appointments are hidden by default in every period, unless
    // the user opts in via the toggle or explicitly filters for CANCELLED.
    if (a.status === 'CANCELLED' && !showCancelled && filterStatus !== 'CANCELLED') return false

    // Status filter
    if (filterStatus && a.status !== filterStatus) return false

    // Date range filter
    if (filterFrom && startTime < new Date(filterFrom)) return false
    if (filterTo) {
      const toDate = new Date(filterTo)
      toDate.setHours(23, 59, 59, 999)
      if (startTime > toDate) return false
    }

    return true
  }).sort((a, b) => {
    const dateA = new Date(a.startTime).getTime()
    const dateB = new Date(b.startTime).getTime()
    return filterPeriod === 'past' ? dateB - dateA : dateA - dateB
  })

  // Count upcoming for header badge
  const upcomingCount = appointments.filter(a => {
    const startTime = new Date(a.startTime)
    return (startTime >= now || isToday(startTime)) && a.status !== 'CANCELLED' && a.isActive
  }).length

  // Handle actions
  const handleComplete = (appointment: Appointment) => {
    setAppointmentToComplete(appointment)
  }

  const handleCancel = (appointment: Appointment) => {
    setConfirmAction({ type: 'cancel', appointment })
  }

  const handlePaymentReversed = async () => {
    await fetchAppointments()
    onPaymentsChange?.()
  }

  const executeAction = async () => {
    if (!confirmAction) return
    setIsActioning(true)
    try {
      await deleteAppointment(confirmAction.appointment.id)
      await fetchAppointments()
      onPaymentsChange?.()
      setConfirmAction(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setIsActioning(false)
    }
  }

  const clearFilters = () => {
    setFilterPeriod('upcoming')
    setFilterStatus('')
    setFilterFrom('')
    setFilterTo('')
    setShowCancelled(false)
  }

  const hasActiveFilters = filterPeriod !== 'upcoming' || filterStatus !== '' || filterFrom !== '' || filterTo !== '' || showCancelled

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* Header - always visible */}
      <div className="flex items-center justify-between px-6 py-4">
        <button
          onClick={toggleCollapse}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <CalendarDays className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            {t('patients.appointments.sectionTitle')}
          </h2>
          {upcomingCount > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {upcomingCount}
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          )}
        </button>

        <div className="flex items-center gap-2">
          {/* New appointment button - always visible */}
          {can(Permission.APPOINTMENTS_CREATE) && (
            <button
              onClick={onNewAppointment}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <CalendarPlus className="h-4 w-4" />
              {t('appointments.newAppointment')}
            </button>
          )}
        </div>
      </div>

      {/* Collapsible content */}
      {!isCollapsed && (
        <div className="px-6 pb-4">
          {/* Filters panel - always visible */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg flex flex-wrap items-center gap-3">
              {/* Period toggle */}
              <div className="inline-flex rounded-lg border border-gray-200 bg-white">
                {(['upcoming', 'past', 'all'] as FilterPeriod[]).map(period => (
                  <button
                    key={period}
                    onClick={() => setFilterPeriod(period)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      filterPeriod === period
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    } ${period === 'upcoming' ? 'rounded-l-lg' : ''} ${period === 'all' ? 'rounded-r-lg' : ''}`}
                  >
                    {t(`patients.appointments.${period}`)}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as AppointmentStatus | '')}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">{t('appointments.allStatuses')}</option>
                <option value="SCHEDULED">{t('appointments.status.scheduled')}</option>
                <option value="CONFIRMED">{t('appointments.status.confirmed')}</option>
                <option value="IN_PROGRESS">{t('appointments.status.inProgress')}</option>
                <option value="COMPLETED">{t('appointments.status.completed')}</option>
                <option value="CANCELLED">{t('appointments.status.cancelled')}</option>
                <option value="NO_SHOW">{t('appointments.status.noShow')}</option>
              </select>

              {/* Date range */}
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                  placeholder={t('patients.appointments.dateFrom')}
                />
                <span className="text-xs text-gray-400">—</span>
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                  placeholder={t('patients.appointments.dateTo')}
                />
              </div>

              {/* Show cancelled toggle */}
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => setShowCancelled(e.target.checked)}
                  className="h-3.5 w-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                {t('appointments.showCancelled')}
              </label>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {t('patients.appointments.clearFilters')}
                </button>
              )}
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-red-600 mb-3">{error}</div>
          )}

          {/* Appointments horizontal scroll */}
          {!isLoading && filteredAppointments.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
              {filteredAppointments.map(appointment => (
                <PatientAppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onEdit={onEditAppointment}
                  onComplete={handleComplete}
                  onCancel={handleCancel}
                  onError={setError}
                  onPaymentReversed={handlePaymentReversed}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && filteredAppointments.length === 0 && !error && (
            <div className="text-center py-6 text-gray-500">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">
                {filterPeriod === 'past'
                  ? t('patients.appointments.noPast')
                  : t('patients.appointments.noUpcoming')}
              </p>
              {can(Permission.APPOINTMENTS_CREATE) && filterPeriod === 'upcoming' && (
                <button
                  onClick={onNewAppointment}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {t('appointments.addAppointment')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation dialog (cancel only — complete uses AppointmentCompleteModal) */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t('appointments.cancelAppointment')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('appointments.confirmCancel')}
            </p>
            {confirmAction.appointment.hasRecordedPayment && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                {t('payments.cancelWithRecordedPayment', {
                  amount: formatCurrency(confirmAction.appointment.recordedPaidAmount ?? 0, currency),
                })}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={isActioning}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t('appointments.keep')}
              </button>
              <button
                onClick={executeAction}
                disabled={isActioning}
                className="px-4 py-2 text-sm text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 bg-red-600 hover:bg-red-700"
              >
                {isActioning && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('appointments.cancelAppointment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete confirmation */}
      <AppointmentCompleteModal
        isOpen={!!appointmentToComplete}
        appointmentId={appointmentToComplete?.id ?? null}
        onClose={() => setAppointmentToComplete(null)}
        onCompleted={() => {
          setAppointmentToComplete(null)
          fetchAppointments()
        }}
      />
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function isToday(date: Date): boolean {
  const today = new Date()
  return (
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate()
  )
}
