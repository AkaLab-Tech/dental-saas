import { useEffect, useState, useCallback, useId } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Edit2,
  AlertCircle,
  Loader2,
  ChevronRight,
  X,
  FileText,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Odontogram } from 'react-odontogram'
import '@/assets/odontogram.css'
import {
  type Patient,
  getPatientById,
  updateToothData,
  deleteToothData,
  updateShowPrimaryTeeth,
  calculateAge,
  getPatientInitials,
} from '@/lib/patient-api'
import { downloadPatientHistoryPdf } from '@/lib/pdf-api'
import { ToothStatus, type ToothData } from '@dental/shared'
import { AppointmentFormModal } from '@/components/appointments/AppointmentFormModal'
import {
  createAppointment,
  updateAppointment,
  getAppointmentApiErrorMessage,
  type CreateAppointmentData,
  type UpdateAppointmentData,
  type Appointment,
} from '@/lib/appointment-api'
import { PatientSidebar } from './PatientSidebar'
import { PatientAppointmentsSection } from './PatientAppointmentsSection'
import { PatientLabworksSection } from './PatientLabworksSection'
import { BudgetsSection } from '@/components/budgets/BudgetsSection'
import { remapPrimaryFdi } from './odontogram-utils'

// ============================================================================
// Types
// ============================================================================

interface ToothDetail {
  id: string
  notations: {
    fdi: string
    universal: string
    palmer: string
  }
  type: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusColorClass(status: ToothStatus): string {
  const classes: Record<ToothStatus, string> = {
    [ToothStatus.CARIES]: 'bg-red-50 border-red-200',
    [ToothStatus.FILLED]: 'bg-blue-50 border-blue-200',
    [ToothStatus.CROWN]: 'bg-cyan-50 border-cyan-200',
    [ToothStatus.ROOT_CANAL]: 'bg-indigo-50 border-indigo-200',
    [ToothStatus.MISSING]: 'bg-gray-50 border-gray-300',
    [ToothStatus.EXTRACTED]: 'bg-gray-50 border-gray-300',
    [ToothStatus.IMPLANT]: 'bg-violet-50 border-violet-200',
    [ToothStatus.BRIDGE]: 'bg-pink-50 border-pink-200',
    [ToothStatus.HEALTHY]: 'bg-amber-50 border-amber-200',
  }
  return classes[status]
}

function getStatusTextColorClass(status: ToothStatus): string {
  const classes: Record<ToothStatus, string> = {
    [ToothStatus.CARIES]: 'text-red-800',
    [ToothStatus.FILLED]: 'text-blue-800',
    [ToothStatus.CROWN]: 'text-cyan-800',
    [ToothStatus.ROOT_CANAL]: 'text-indigo-800',
    [ToothStatus.MISSING]: 'text-gray-700',
    [ToothStatus.EXTRACTED]: 'text-gray-700',
    [ToothStatus.IMPLANT]: 'text-violet-800',
    [ToothStatus.BRIDGE]: 'text-pink-800',
    [ToothStatus.HEALTHY]: 'text-amber-800',
  }
  return classes[status]
}

// ============================================================================
// Tooth Details Modal Component
// ============================================================================

interface ToothDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: ToothData) => void
  onDelete?: () => void
  toothNumber: string
  toothType: string
  currentData?: ToothData
  isLoading?: boolean
}

function ToothDetailsModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  toothNumber,
  toothType,
  currentData = { note: '', status: ToothStatus.HEALTHY },
  isLoading = false,
}: ToothDetailsModalProps) {
  const { t } = useTranslation()
  const [note, setNote] = useState(currentData.note)
  const [status, setStatus] = useState(currentData.status)
  const titleId = useId()
  const textareaId = useId()
  const statusId = useId()

  if (!isOpen) return null

  const handleSave = () => {
    onSave({ note: note.trim(), status })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">
              {t('patients.tooth')} #{toothNumber}
            </h2>
            <p className="text-sm text-gray-500">{toothType}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Status Selector */}
          <div>
            <label htmlFor={statusId} className="block text-sm font-medium text-gray-700 mb-2">
              {t('patients.toothStatus')}
            </label>
            <select
              id={statusId}
              value={status}
              onChange={(e) => setStatus(e.target.value as ToothStatus)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading}
            >
              <option value={ToothStatus.HEALTHY}>{t('patients.status.healthy')}</option>
              <option value={ToothStatus.CARIES}>{t('patients.status.caries')}</option>
              <option value={ToothStatus.FILLED}>{t('patients.status.filled')}</option>
              <option value={ToothStatus.CROWN}>{t('patients.status.crown')}</option>
              <option value={ToothStatus.ROOT_CANAL}>{t('patients.status.root_canal')}</option>
              <option value={ToothStatus.MISSING}>{t('patients.status.missing')}</option>
              <option value={ToothStatus.EXTRACTED}>{t('patients.status.extracted')}</option>
              <option value={ToothStatus.IMPLANT}>{t('patients.status.implant')}</option>
              <option value={ToothStatus.BRIDGE}>{t('patients.status.bridge')}</option>
            </select>
          </div>

          {/* Notes Textarea */}
          <div>
            <label htmlFor={textareaId} className="block text-sm font-medium text-gray-700 mb-2">
              {t('patients.clinicalNotes')}
            </label>
            <textarea
              id={textareaId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('patients.enterNotes')}
              rows={4}
              maxLength={1000}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              disabled={isLoading}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {note.length}/1000 {t('patients.characters')}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-100">
          <div>
            {(currentData.note || currentData.status !== ToothStatus.HEALTHY) && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={isLoading}
                className="text-red-600 hover:text-red-700 text-sm font-medium disabled:opacity-50"
              >
                {t('common.delete')}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('patients.saving')}
                </>
              ) : (
                t('common.save')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Patient Detail Page
// ============================================================================

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dental chart state
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null)
  const [selectedToothType, setSelectedToothType] = useState<string>('')
  const [isToothModalOpen, setIsToothModalOpen] = useState(false)
  const [isSavingTooth, setIsSavingTooth] = useState(false)
  const [showPrimaryTeeth, setShowPrimaryTeeth] = useState(false)
  const [isSavingShowPrimaryTeeth, setIsSavingShowPrimaryTeeth] = useState(false)
  const [showPrimaryTeethError, setShowPrimaryTeethError] = useState<string | null>(null)
  const [odontogramKey, setOdontogramKey] = useState(0)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [imageRefreshKey, setImageRefreshKey] = useState(0)
  const [isAppointmentFormOpen, setIsAppointmentFormOpen] = useState(false)
  const [isCreatingAppointment, setIsCreatingAppointment] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [appointmentFormError, setAppointmentFormError] = useState<string | null>(null)
  const [appointmentsRefreshKey, setAppointmentsRefreshKey] = useState(0)
  const [paymentsRefreshKey, setPaymentsRefreshKey] = useState(0)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('patient-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('patient-sidebar-collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Fetch patient data
  useEffect(() => {
    if (!id) return

    const fetchPatient = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getPatientById(id)
        setPatient(data)
        setShowPrimaryTeeth(data.showPrimaryTeeth)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar el paciente')
      } finally {
        setIsLoading(false)
      }
    }

    fetchPatient()
  }, [id])

  // Toggle the per-patient primary-teeth chart with optimistic UI and rollback on error.
  const handleShowPrimaryTeethToggle = useCallback(
    async (nextValue: boolean) => {
      if (!id || isSavingShowPrimaryTeeth) return
      const previousValue = showPrimaryTeeth
      setShowPrimaryTeeth(nextValue)
      setIsSavingShowPrimaryTeeth(true)
      setShowPrimaryTeethError(null)
      try {
        const persisted = await updateShowPrimaryTeeth(id, nextValue)
        setShowPrimaryTeeth(persisted)
        setPatient(prev => (prev ? { ...prev, showPrimaryTeeth: persisted } : prev))
      } catch {
        setShowPrimaryTeeth(previousValue)
        setShowPrimaryTeethError(t('patients.showPrimaryTeethError'))
      } finally {
        setIsSavingShowPrimaryTeeth(false)
      }
    },
    [id, showPrimaryTeeth, isSavingShowPrimaryTeeth, t]
  )

  // Handle odontogram change - when a tooth is clicked
  const handleOdontogramChange = useCallback((selected: ToothDetail[]) => {
    // When user clicks a tooth, the last selected tooth is the one we want
    if (selected.length > 0) {
      const lastTooth = selected[selected.length - 1]
      const fdiNumber = lastTooth.notations.fdi
      setSelectedTooth(fdiNumber)
      setSelectedToothType(lastTooth.type)
      setIsToothModalOpen(true)
      // Reset odontogram to clear the library's internal selection state
      setOdontogramKey(k => k + 1)
    }
  }, [])

  // Primary (deciduous) teeth variant: remap quadrants 1-4 → 5-8 before saving.
  const handlePrimaryOdontogramChange = useCallback((selected: ToothDetail[]) => {
    if (selected.length > 0) {
      const lastTooth = selected[selected.length - 1]
      const fdiNumber = remapPrimaryFdi(lastTooth.notations.fdi)
      setSelectedTooth(fdiNumber)
      setSelectedToothType(lastTooth.type)
      setIsToothModalOpen(true)
      setOdontogramKey(k => k + 1)
    }
  }, [])

  // Handle save tooth data
  const handleSaveToothData = useCallback(async (data: ToothData) => {
    if (!patient || !selectedTooth) return

    setIsSavingTooth(true)
    try {
      const updated = await updateToothData(patient.id, selectedTooth, data)
      setPatient(updated)
      setIsToothModalOpen(false)
      setSelectedTooth(null)
      setSelectedToothType('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar los datos del diente')
    } finally {
      setIsSavingTooth(false)
    }
  }, [patient, selectedTooth])

  // Handle delete tooth data
  const handleDeleteToothData = useCallback(async () => {
    if (!patient || !selectedTooth) return

    setIsSavingTooth(true)
    try {
      const updated = await deleteToothData(patient.id, selectedTooth)
      setPatient(updated)
      setIsToothModalOpen(false)
      setSelectedTooth(null)
      setSelectedToothType('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar los datos del diente')
    } finally {
      setIsSavingTooth(false)
    }
  }, [patient, selectedTooth])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  // Error state
  if (error && !patient) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/patients')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="h-5 w-5" />
          Volver a pacientes
        </button>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="h-6 w-6 text-red-500 shrink-0" />
          <div>
            <h3 className="font-medium text-red-800">Error</h3>
            <p className="text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!patient) return null

  const age = patient.dob ? calculateAge(patient.dob) : null
  const initials = getPatientInitials(patient)
  // Normalize teeth data (handle both old string format and new ToothData format)
  const teeth: Record<string, ToothData> = {}
  if (patient.teeth) {
    for (const [toothNumber, value] of Object.entries(patient.teeth)) {
      if (typeof value === 'string') {
        teeth[toothNumber] = { note: value, status: ToothStatus.HEALTHY }
      } else if (typeof value === 'object' && value !== null) {
        teeth[toothNumber] = value as ToothData
      }
    }
  }

  // Generate per-tooth color based on status
  function getToothColor(status: ToothStatus, hasNote: boolean): string | null {
    switch (status) {
      case ToothStatus.CARIES: return '#ef4444'       // red
      case ToothStatus.FILLED: return '#3b82f6'       // blue
      case ToothStatus.CROWN: return '#06b6d4'        // cyan
      case ToothStatus.ROOT_CANAL: return '#6366f1'   // indigo
      case ToothStatus.MISSING:
      case ToothStatus.EXTRACTED: return '#9ca3af'    // gray
      case ToothStatus.IMPLANT: return '#8b5cf6'      // violet
      case ToothStatus.BRIDGE: return '#ec4899'       // pink
      case ToothStatus.HEALTHY: return hasNote ? '#f59e0b' : null // amber
    }
  }

  // Generate dynamic CSS to color individual teeth in the SVG.
  // The library renders each tooth as <g class="teeth-{quadrant}{toothIndex}">
  // using only quadrants 1-4. Primary teeth are stored with FDI quadrants 5-8
  // but the library still renders them under quadrants 1-4 inside the
  // .odontogram-primary wrapper, so we scope the CSS rule per chart and map
  // the stored FDI back to the rendered class name for primary teeth.
  const teethStyleRules: string[] = []
  for (const [toothNumber, toothData] of Object.entries(teeth)) {
    const color = getToothColor(toothData.status, !!toothData.note)
    if (!color) continue
    if (toothNumber.length !== 2) continue
    const quadrant = Number(toothNumber[0])
    const isPrimary = quadrant >= 5 && quadrant <= 8
    const scope = isPrimary ? '.odontogram-primary' : '.odontogram-permanent'
    const libClass = isPrimary
      ? `teeth-${quadrant - 4}${toothNumber[1]}`
      : `teeth-${toothNumber}`
    const isMissing = toothData.status === ToothStatus.MISSING || toothData.status === ToothStatus.EXTRACTED
    if (isMissing) {
      teethStyleRules.push(
        `${scope} g.${libClass}{color:${color};opacity:0.25}`,
      )
    } else {
      teethStyleRules.push(
        `${scope} g.${libClass}{color:${color}}`,
        `${scope} g.${libClass} path:nth-of-type(2){fill:${color};opacity:0.3}`,
      )
    }
  }

  // Renders the tooth tooltip. `remapFdi` is used by the primary chart to
  // convert the raw FDI reported by the library (quadrants 1-4) into the
  // actual primary tooth FDI (quadrants 5-8) before looking up tooth data.
  const buildToothTooltipRenderer = (remapFdi: (raw: string) => string) =>
    (payload?: ToothDetail) => {
      if (!payload) return null
      const fdi = remapFdi(payload.notations.fdi)
      const toothData = teeth[fdi]
      const statusKey = toothData?.status || ToothStatus.HEALTHY
      const note = toothData?.note || ''
      const truncatedNote = note.length > 80 ? note.slice(0, 80) + '...' : note

      return (
        <div style={{ maxWidth: 250 }}>
          <div style={{ fontWeight: 600 }}>
            {t('patients.tooth')} {fdi} — {t(`patients.toothType.${payload.type}`, payload.type)}
          </div>
          <div style={{ marginTop: 2 }}>
            {t('patients.toothStatus')}: {t(`patients.status.${statusKey}`)}
          </div>
          {note && (
            <div style={{ marginTop: 4, opacity: 0.85, fontStyle: 'italic' }}>
              {truncatedNote}
            </div>
          )}
        </div>
      )
    }

  const renderToothTooltip = buildToothTooltipRenderer((fdi) => fdi)
  const renderPrimaryToothTooltip = buildToothTooltipRenderer(remapPrimaryFdi)

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/patients" className="hover:text-gray-700">
          Pacientes
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900 font-medium">
          {patient.firstName} {patient.lastName}
        </span>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Patient Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xl font-semibold text-blue-600">{initials}</span>
            </div>

            {/* Name and status */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {patient.firstName} {patient.lastName}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    patient.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {patient.isActive ? 'Activo' : 'Inactivo'}
                </span>
                {age !== null && (
                  <span className="text-gray-500 text-sm">{age} años</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setIsDownloadingPdf(true)
                try {
                  await downloadPatientHistoryPdf(patient.id)
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Error al descargar el PDF')
                } finally {
                  setIsDownloadingPdf(false)
                }
              }}
              disabled={isDownloadingPdf}
              className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {isDownloadingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Exportar PDF
            </button>
            <Link
              to={`/patients?edit=${patient.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Edit2 className="h-4 w-4" />
              Editar
            </Link>
          </div>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-1 md:grid-cols-2 min-[1180px]:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {patient.email && (
            <div className="flex items-center gap-3 text-gray-600">
              <Mail className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{patient.email}</span>
            </div>
          )}
          {patient.phone && (
            <div className="flex items-center gap-3 text-gray-600">
              <Phone className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{patient.phone}</span>
            </div>
          )}
          {patient.dob && (
            <div className="flex items-center gap-3 text-gray-600">
              <Calendar className="h-5 w-5 text-gray-400" />
              <span className="text-sm">
                {new Date(patient.dob).toLocaleDateString('es-MX', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}
          {patient.address && (
            <div className="flex items-center gap-3 text-gray-600">
              <MapPin className="h-5 w-5 text-gray-400" />
              <span className="text-sm">{patient.address}</span>
            </div>
          )}
          {patient.gender && (
            <div className="flex items-center gap-3 text-gray-600">
              <User className="h-5 w-5 text-gray-400" />
              <span className="text-sm capitalize">
                {patient.gender === 'male' && 'Masculino'}
                {patient.gender === 'female' && 'Femenino'}
                {patient.gender === 'other' && 'Otro'}
                {patient.gender === 'prefer_not_to_say' && 'Prefiere no decir'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Appointments Section */}
      <PatientAppointmentsSection
        patientId={patient.id}
        onNewAppointment={() => {
          setEditingAppointment(null)
          setAppointmentFormError(null)
          setIsAppointmentFormOpen(true)
        }}
        onEditAppointment={(appointment) => {
          setEditingAppointment(appointment)
          setAppointmentFormError(null)
          setIsAppointmentFormOpen(true)
        }}
        refreshKey={appointmentsRefreshKey}
      />

      {/* Labworks Section */}
      <PatientLabworksSection patientId={patient.id} />

      {/* Budgets Section */}
      <BudgetsSection patientId={patient.id} />

      {/* Two-column layout: Sidebar (Images + Payments) | Odontogram */}
      <div className="flex flex-col min-[1180px]:flex-row gap-6">
        {/* Sidebar */}
        <PatientSidebar
          patientId={patient.id}
          isCollapsed={isSidebarCollapsed}
          onToggle={toggleSidebar}
          imageRefreshKey={imageRefreshKey}
          onImageUploadComplete={() => setImageRefreshKey((k) => k + 1)}
          paymentsRefreshKey={paymentsRefreshKey}
          onPaymentsChange={() => setAppointmentsRefreshKey((k) => k + 1)}
        />

        {/* Dental Chart Section */}
        <div className="flex-1 min-w-0 order-1 min-[1180px]:order-2">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">Odontograma</h2>
          <div className="flex flex-col items-end gap-1">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showPrimaryTeeth}
                disabled={isSavingShowPrimaryTeeth}
                onChange={(e) => handleShowPrimaryTeethToggle(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
              />
              {t('patients.showPrimaryTeeth')}
              {isSavingShowPrimaryTeeth && (
                <Loader2
                  aria-label={t('common.saving')}
                  className="w-4 h-4 animate-spin text-blue-500"
                />
              )}
            </label>
            {showPrimaryTeethError && (
              <span role="alert" className="text-xs text-red-600">
                {showPrimaryTeethError}
              </span>
            )}
          </div>
        </div>

        {/* Dynamic per-tooth status colors */}
        {teethStyleRules.length > 0 && (
          <style dangerouslySetInnerHTML={{ __html: teethStyleRules.join('') }} />
        )}

        {/* Two-column layout: Odontogram left, teeth cards right */}
        <div className="flex flex-col xl:flex-row gap-4">
          {/* Left column - Odontogram + Legend */}
          <div className="flex-1 min-w-0">
            {/* Combined Dental Chart - Permanent with Primary overlaid */}
            <div className="relative flex flex-col items-center">
              {/* Permanent Teeth (base layer) */}
              <div className="odontogram-permanent">
                <Odontogram
                  key={`permanent-${odontogramKey}`}
                  onChange={handleOdontogramChange}
                  theme="light"
                  colors={{}}
                  notation="FDI"
                  maxTeeth={8}
                  showTooltip={true}
                  tooltip={{ placement: 'bottom', margin: 8, content: renderToothTooltip }}
                />
              </div>

              {/* Primary Teeth (overlaid, smaller, centered) */}
              {showPrimaryTeeth && (
                <div
                  className="odontogram-primary absolute inset-0 flex items-center justify-center pointer-events-none [&_.Odontogram_g]:pointer-events-auto"
                >
                  <Odontogram
                    key={`primary-${odontogramKey}`}
                    onChange={handlePrimaryOdontogramChange}
                    theme="light"
                    colors={{}}
                    notation="FDI"
                    maxTeeth={5}
                    showTooltip={true}
                    tooltip={{ placement: 'bottom', margin: 8, content: renderPrimaryToothTooltip }}
                  />
                </div>
              )}
            </div>

          </div>

          {/* Right column - Teeth data summary (chips) */}
          {Object.keys(teeth).length > 0 && (
            <div className="xl:w-64 xl:shrink-0">
              <h3 className="text-xs font-medium text-gray-500 mb-2">
                {t('patients.registeredTeeth')} ({Object.keys(teeth).length})
              </h3>
              <div className="flex flex-wrap gap-1.5 xl:max-h-[400px] xl:overflow-y-auto xl:pr-1">
                {Object.entries(teeth).map(([toothNumber, toothData]) => (
                  <div
                    key={toothNumber}
                    className={`group inline-flex items-center gap-1 px-2 py-1 border rounded-full text-xs font-medium ${getStatusColorClass(toothData.status)}`}
                  >
                    <button
                      onClick={() => {
                        setSelectedTooth(toothNumber)
                        setSelectedToothType('')
                        setIsToothModalOpen(true)
                      }}
                      className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                    >
                      <span className={`font-semibold ${getStatusTextColorClass(toothData.status)}`}>
                        #{toothNumber}
                      </span>
                      <span className={`${getStatusTextColorClass(toothData.status)} opacity-75`}>
                        {t(`patients.status.${toothData.status}`)}
                      </span>
                    </button>
                    <div className="w-3 h-3 flex items-center justify-center">
                      {toothData.note && (
                        <FileText className={`h-3 w-3 ${getStatusTextColorClass(toothData.status)} opacity-50 group-hover:hidden`} />
                      )}
                      <button
                        onClick={async () => {
                          setIsSavingTooth(true)
                          try {
                            const updated = await deleteToothData(patient.id, toothNumber)
                            setPatient(updated)
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Error')
                          } finally {
                            setIsSavingTooth(false)
                          }
                        }}
                        disabled={isSavingTooth}
                        className="hidden group-hover:inline-flex p-0 rounded-full hover:bg-black/10 transition-opacity disabled:opacity-50"
                        title={t('common.delete')}
                      >
                        <X className="h-3 w-3 text-gray-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status Color Legend - full width */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <h3 className="text-xs font-medium text-gray-500 mb-2">{t('patients.statusLegend')}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
              <span className="text-gray-600">{t('patients.status.caries')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
              <span className="text-gray-600">{t('patients.status.filled')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#06b6d4' }} />
              <span className="text-gray-600">{t('patients.status.crown')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#6366f1' }} />
              <span className="text-gray-600">{t('patients.status.root_canal')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#9ca3af' }} />
              <span className="text-gray-600">{t('patients.missingExtracted')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#8b5cf6' }} />
              <span className="text-gray-600">{t('patients.status.implant')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ec4899' }} />
              <span className="text-gray-600">{t('patients.status.bridge')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
              <span className="text-gray-600">{t('patients.withNotes')}</span>
            </div>
          </div>
        </div>
      </div>
      </div>
      </div>

      {/* Appointment Form Modal */}
      <AppointmentFormModal
        isOpen={isAppointmentFormOpen}
        onClose={() => {
          setIsAppointmentFormOpen(false)
          setEditingAppointment(null)
          setAppointmentFormError(null)
        }}
        onSubmit={async (data) => {
          setIsCreatingAppointment(true)
          setAppointmentFormError(null)
          try {
            if (editingAppointment) {
              await updateAppointment(editingAppointment.id, data as UpdateAppointmentData)
            } else {
              await createAppointment(data as CreateAppointmentData)
            }
            setIsAppointmentFormOpen(false)
            setEditingAppointment(null)
            // FIFO may have created a payment and recalculated isPaid on
            // multiple billable items, so refresh both sections.
            setAppointmentsRefreshKey(k => k + 1)
            setPaymentsRefreshKey(k => k + 1)
          } catch (e) {
            setAppointmentFormError(getAppointmentApiErrorMessage(e))
          } finally {
            setIsCreatingAppointment(false)
          }
        }}
        appointment={editingAppointment}
        isLoading={isCreatingAppointment}
        defaultPatientId={patient.id}
        error={appointmentFormError}
      />

      {/* Tooth Details Modal */}
      <ToothDetailsModal
        key={selectedTooth || ''}
        isOpen={isToothModalOpen}
        onClose={() => {
          setIsToothModalOpen(false)
          setSelectedTooth(null)
          setSelectedToothType('')
        }}
        onSave={handleSaveToothData}
        onDelete={teeth[selectedTooth || ''] ? handleDeleteToothData : undefined}
        toothNumber={selectedTooth || ''}
        toothType={selectedToothType}
        currentData={selectedTooth ? teeth[selectedTooth] : { note: '', status: ToothStatus.HEALTHY }}
        isLoading={isSavingTooth}
      />
    </div>
  )
}
