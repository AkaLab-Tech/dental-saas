import { Clock, User, Stethoscope, MoreVertical, Edit, Trash2, RotateCcw, CheckCircle, FileText, Loader2, ImageIcon, ChevronDown, ChevronUp } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentModule } from '@dental/shared'
import { useAuthStore } from '@/stores/auth.store'
import { downloadAppointmentPdf } from '@/lib/pdf-api'
import type { Appointment } from '@/lib/appointment-api'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { ImageGallery } from '@/components/ui/ImageGallery'
import {
  getStatusLabel,
  getStatusBadgeClasses,
  formatTimeRange,
  getAppointmentPatientName,
  getAppointmentDoctorName,
} from '@/lib/appointment-api'
import { formatCurrency } from '@/lib/format'

interface AppointmentCardProps {
  appointment: Appointment
  onEdit: (appointment: Appointment) => void
  onDelete: (appointment: Appointment) => void
  onRestore: (appointment: Appointment) => void
  onComplete: (appointment: Appointment) => void
  onError?: (message: string) => void
}

export function AppointmentCard({
  appointment,
  onEdit,
  onDelete,
  onRestore,
  onComplete,
  onError,
}: AppointmentCardProps) {
  const { t } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const [showMenu, setShowMenu] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [showImages, setShowImages] = useState(false)
  const [imageRefreshKey, setImageRefreshKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isInactive = !appointment.isActive
  const canComplete = appointment.isActive && 
    !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)

  return (
    <div
      className={`bg-white border rounded-lg p-4 ${
        isInactive ? 'border-gray-200 bg-gray-50 opacity-75' : 'border-gray-200 hover:border-gray-300'
      } transition-colors`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Time */}
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <Clock className="h-4 w-4 text-gray-400" />
              {formatTimeRange(appointment.startTime, appointment.endTime)}
            </div>

            {/* Status badge */}
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(appointment.status)}`}>
              {getStatusLabel(appointment.status)}
            </span>

            {/* Type */}
            {appointment.type && (
              <span className="text-sm text-gray-500">{appointment.type}</span>
            )}
          </div>

          {/* Patient */}
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <User className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{getAppointmentPatientName(appointment)}</span>
            {appointment.patient?.phone && (
              <span className="text-gray-400">• {appointment.patient.phone}</span>
            )}
          </div>

          {/* Doctor */}
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
            <Stethoscope className="h-4 w-4 text-gray-400" />
            <span>{getAppointmentDoctorName(appointment)}</span>
            {appointment.doctor?.specialty && (
              <span className="text-gray-400">• {appointment.doctor.specialty}</span>
            )}
          </div>

          {/* Notes */}
          {appointment.notes && (
            <p className="mt-2 text-sm text-gray-500 line-clamp-1">{appointment.notes}</p>
          )}

          {/* Cost */}
          {appointment.cost !== null && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className={appointment.isPaid ? 'text-green-600' : 'text-amber-600'}>
                {formatCurrency(appointment.cost!, currency)}
              </span>
              {appointment.isPaid ? (
                <span className="text-xs text-green-600">(Pagado)</span>
              ) : (
                <span className="text-xs text-amber-600">(Pendiente)</span>
              )}
            </div>
          )}
        </div>

        {/* Actions menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            aria-label={t('appointments.moreOptions')}
          >
            <MoreVertical className="h-5 w-5 text-gray-400" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
              {isInactive ? (
                <button
                  onClick={() => {
                    onRestore(appointment)
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onEdit(appointment)
                      setShowMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Edit className="h-4 w-4" />
                    Editar
                  </button>

                  <button
                    onClick={async () => {
                      setIsDownloadingPdf(true)
                      try {
                        await downloadAppointmentPdf(appointment.id)
                      } catch (e) {
                        const message = e instanceof Error ? e.message : 'Error al descargar el PDF'
                        onError?.(message)
                      } finally {
                        setIsDownloadingPdf(false)
                        setShowMenu(false)
                      }
                    }}
                    disabled={isDownloadingPdf}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    Descargar PDF
                  </button>

                  {canComplete && (
                    <button
                      onClick={() => {
                        onComplete(appointment)
                        setShowMenu(false)
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Marcar completada
                    </button>
                  )}

                  <button
                    onClick={() => {
                      onDelete(appointment)
                      setShowMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Cancelar cita
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible images section */}
      {!isInactive && (
        <div className="border-t border-gray-100 mt-3 pt-2">
          <button
            onClick={() => setShowImages(!showImages)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ImageIcon className="h-4 w-4" />
            {t('attachments.title')}
            {showImages ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showImages && (
            <div className="mt-3 space-y-3">
              <ImageUpload
                module={AttachmentModule.APPOINTMENTS}
                entityId={appointment.id}
                onUploadComplete={() => setImageRefreshKey((k) => k + 1)}
              />
              <ImageGallery
                module={AttachmentModule.APPOINTMENTS}
                entityId={appointment.id}
                refreshKey={imageRefreshKey}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
