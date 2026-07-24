import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  ChevronRight,
  Stethoscope,
  Phone,
  Mail,
  Clock,
  Edit2,
  BadgeCheck,
  Building2,
  FileText,
} from 'lucide-react'
import { getDoctorById, updateDoctor, type Doctor, type UpdateDoctorData } from '@/lib/doctor-api'
import {
  updateAppointment,
  getAppointmentApiErrorMessage,
  type Appointment,
  type UpdateAppointmentData,
} from '@/lib/appointment-api'
import { DoctorFormModal } from '@/components/doctors/DoctorFormModal'
import { AppointmentFormModal } from '@/components/appointments/AppointmentFormModal'
import { DoctorAppointmentsSection } from './DoctorAppointmentsSection'

// ============================================================================
// Constants
// ============================================================================

const DAYS_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

const DAY_KEY_MAP: Record<string, string> = {
  MON: 'mon',
  TUE: 'tue',
  WED: 'wed',
  THU: 'thu',
  FRI: 'fri',
  SAT: 'sat',
  SUN: 'sun',
}

// ============================================================================
// DoctorDetailPage
// ============================================================================

export default function DoctorDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [isAppointmentFormOpen, setIsAppointmentFormOpen] = useState(false)
  const [isSavingAppointment, setIsSavingAppointment] = useState(false)
  const [appointmentFormError, setAppointmentFormError] = useState<string | null>(null)
  const [appointmentsRefreshKey, setAppointmentsRefreshKey] = useState(0)

  useEffect(() => {
    if (!id) return

    const fetchDoctor = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getDoctorById(id)
        setDoctor(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : t('doctors.detail.loadError'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchDoctor()
  }, [id, t])

  const handleEditSubmit = async (data: UpdateDoctorData) => {
    if (!id) return
    setIsSaving(true)
    try {
      const updated = await updateDoctor(id, data)
      setDoctor(updated)
      setIsEditModalOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('doctors.detail.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  // Error state (no doctor loaded)
  if (error && !doctor) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/doctors')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="h-5 w-5" />
          {t('doctors.detail.backToDoctors')}
        </button>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="h-6 w-6 text-red-500 shrink-0" />
          <div>
            <h3 className="font-medium text-red-800">{t('common.error')}</h3>
            <p className="text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!doctor) return null

  const initials = `${doctor.firstName[0]}${doctor.lastName[0]}`.toUpperCase()
  const sortedWorkingDays = [...(doctor.workingDays || [])].sort(
    (a, b) => DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b)
  )
  const DAYS_MAP = Object.fromEntries(
    DAYS_ORDER.map((day) => [day, t(`doctors.days.${DAY_KEY_MAP[day]}`)])
  )
  const DAYS_SHORT = Object.fromEntries(
    DAYS_ORDER.map((day) => [day, t(`doctors.days.short.${DAY_KEY_MAP[day]}`)])
  )

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/doctors" className="hover:text-gray-700">
          {t('doctors.title')}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900 font-medium">
          Dr. {doctor.firstName} {doctor.lastName}
        </span>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Doctor Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            {doctor.avatar ? (
              <img
                src={doctor.avatar}
                alt={`Dr. ${doctor.firstName} ${doctor.lastName}`}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <span className="text-xl font-semibold text-white">{initials}</span>
              </div>
            )}

            {/* Name and status */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Dr. {doctor.firstName} {doctor.lastName}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    doctor.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-orange-100 text-orange-800'
                  }`}
                >
                  {doctor.isActive ? t('common.active') : t('common.inactive')}
                </span>
                {doctor.specialty && (
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <Stethoscope className="h-4 w-4" />
                    {doctor.specialty}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Edit2 className="h-4 w-4" />
            {t('common.edit')}
          </button>
        </div>

        {/* Contact & details */}
        <div className="grid grid-cols-1 md:grid-cols-2 min-[1180px]:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {doctor.email && (
            <div className="flex items-center gap-3 text-gray-600">
              <Mail className="h-5 w-5 text-gray-400" />
              <span className="text-sm truncate">{doctor.email}</span>
            </div>
          )}
          {doctor.phone && (
            <div className="flex items-center gap-3 text-gray-600">
              <Phone className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{doctor.phone}</span>
            </div>
          )}
          {doctor.licenseNumber && (
            <div className="flex items-center gap-3 text-gray-600">
              <BadgeCheck className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{t('doctors.detail.license', { license: doctor.licenseNumber })}</span>
            </div>
          )}
          {doctor.consultingRoom && (
            <div className="flex items-center gap-3 text-gray-600">
              <Building2 className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{t('doctors.detail.consultingRoom', { room: doctor.consultingRoom })}</span>
            </div>
          )}
          {doctor.hourlyRate != null && (
            <div className="flex items-center gap-3 text-gray-600">
              <FileText className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{t('doctors.detail.hourlyRate', { rate: doctor.hourlyRate })}</span>
            </div>
          )}
          {doctor.commissionPercentage != null && (
            <div className="flex items-center gap-3 text-gray-600">
              <FileText className="h-5 w-5 text-gray-400" />
              <span className="text-sm">
                {t('doctors.detail.commissionPercentage', { percentage: doctor.commissionPercentage })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Schedule */}
      {(sortedWorkingDays.length > 0 || doctor.workingHours) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-blue-600" />
            {t('doctors.detail.workSchedule')}
          </h2>

          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Working days */}
            {sortedWorkingDays.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">{t('doctors.list.workingDays')}</p>
                <div className="flex gap-1.5">
                  {DAYS_ORDER.map((day) => {
                    const isWorking = sortedWorkingDays.includes(day)
                    return (
                      <span
                        key={day}
                        title={DAYS_MAP[day]}
                        className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-medium ${
                          isWorking
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {DAYS_SHORT[day]}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Working hours */}
            {doctor.workingHours && (
              <div>
                <p className="text-xs text-gray-500 mb-2">{t('doctors.detail.schedule')}</p>
                <p className="text-sm text-gray-700 font-medium">
                  {doctor.workingHours.start} — {doctor.workingHours.end}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bio */}
      {doctor.bio && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('doctors.bio')}</h2>
          <p className="text-sm text-gray-600 whitespace-pre-line">{doctor.bio}</p>
        </div>
      )}

      {/* Appointments Section */}
      <DoctorAppointmentsSection
        doctorId={doctor.id}
        onEditAppointment={(appointment) => {
          setEditingAppointment(appointment)
          setAppointmentFormError(null)
          setIsAppointmentFormOpen(true)
        }}
        refreshKey={appointmentsRefreshKey}
      />

      {/* Edit Doctor Modal */}
      <DoctorFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditSubmit}
        doctor={doctor}
        isLoading={isSaving}
      />

      {/* Edit Appointment Modal */}
      <AppointmentFormModal
        isOpen={isAppointmentFormOpen}
        onClose={() => {
          setIsAppointmentFormOpen(false)
          setEditingAppointment(null)
          setAppointmentFormError(null)
        }}
        onSubmit={async (data) => {
          if (!editingAppointment) return
          setIsSavingAppointment(true)
          setAppointmentFormError(null)
          try {
            await updateAppointment(editingAppointment.id, data as UpdateAppointmentData)
            setIsAppointmentFormOpen(false)
            setEditingAppointment(null)
            setAppointmentsRefreshKey(k => k + 1)
          } catch (e) {
            setAppointmentFormError(getAppointmentApiErrorMessage(e))
          } finally {
            setIsSavingAppointment(false)
          }
        }}
        appointment={editingAppointment}
        isLoading={isSavingAppointment}
        error={appointmentFormError}
      />
    </div>
  )
}
