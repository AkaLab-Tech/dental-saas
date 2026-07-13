import { useState } from 'react'
import {
  FlaskConical,
  Calendar,
  DollarSign,
  Pencil,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Clock,
  Package,
  User,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  Phone,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission, AttachmentModule } from '@dental/shared'
import type { Labwork } from '@/lib/labwork-api'
import { getLabworkStatusBadge } from '@/lib/labwork-api'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { ImageGallery } from '@/components/ui/ImageGallery'

interface LabworkCardProps {
  labwork: Labwork
  onEdit: (labwork: Labwork) => void
  onDelete: (labwork: Labwork) => void
  onRestore?: (labwork: Labwork) => void
  onTogglePaid?: (labwork: Labwork) => void
  onToggleDelivered?: (labwork: Labwork) => void
}

export function LabworkCard({
  labwork,
  onEdit,
  onDelete,
  onRestore,
  onTogglePaid,
  onToggleDelivered,
}: LabworkCardProps) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const [showImages, setShowImages] = useState(false)
  const [imageRefreshKey, setImageRefreshKey] = useState(0)
  const statusBadge = getLabworkStatusBadge(labwork)
  const isDeleted = !!labwork.deletedAt

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow ${isDeleted ? 'border-orange-200 bg-orange-50/30' : 'border-gray-200'
        }`}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <FlaskConical className="h-6 w-6 text-white" />
            </div>

            {/* Lab name & Date */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{labwork.lab}</h3>
              <div className="flex items-center gap-1.5 mt-0.5 text-sm text-gray-600">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span>{formatDate(labwork.date)}</span>
              </div>
              {labwork.phoneNumber && (
                <a
                  href={`tel:${labwork.phoneNumber}`}
                  className="flex items-center gap-1.5 mt-0.5 text-sm text-blue-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="h-4 w-4 text-gray-400" />
                  <span>{labwork.phoneNumber}</span>
                </a>
              )}
            </div>
          </div>

          {/* Status badge */}
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge.variant === 'success'
                ? 'bg-green-100 text-green-800'
                : statusBadge.variant === 'warning'
                  ? 'bg-amber-100 text-amber-800'
                  : statusBadge.variant === 'destructive'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-800'
              }`}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Patient info */}
        {labwork.patient && (
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
            <User className="h-4 w-4 text-gray-400" />
            <span>
              {labwork.patient.firstName} {labwork.patient.lastName}
            </span>
          </div>
        )}

        {/* Price */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <DollarSign className="h-4 w-4 text-gray-400" />
          <span className="font-medium text-gray-900">{formatCurrency(labwork.price, currency)}</span>
          {labwork.priceIncludedInAppointment && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {t('labworks.includedInAppointment')}
            </span>
          )}
        </div>

        {/* Status toggles */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => onTogglePaid?.(labwork)}
            disabled={isDeleted || !can(Permission.LABWORKS_UPDATE)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${labwork.isPaid
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${isDeleted || !can(Permission.LABWORKS_UPDATE) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {labwork.isPaid ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
            {labwork.isPaid ? 'Pagado' : 'Pendiente'}
          </button>

          <button
            onClick={() => onToggleDelivered?.(labwork)}
            disabled={isDeleted || !can(Permission.LABWORKS_UPDATE)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${labwork.isDelivered
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${isDeleted || !can(Permission.LABWORKS_UPDATE) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Package className="h-4 w-4" />
            {labwork.isDelivered ? 'Entregado' : 'Por entregar'}
          </button>
        </div>

        {/* Notes */}
        {labwork.note && (
          <p className="text-sm text-gray-500 mb-4 line-clamp-2">{labwork.note}</p>
        )}

        {/* Images section */}
        {!isDeleted && (
          <div className="mb-4">
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
                  module={AttachmentModule.LABWORKS}
                  entityId={labwork.id}
                  onUploadComplete={() => setImageRefreshKey((k) => k + 1)}
                />
                <ImageGallery
                  module={AttachmentModule.LABWORKS}
                  entityId={labwork.id}
                  refreshKey={imageRefreshKey}
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
          {isDeleted && onRestore ? (
            can(Permission.LABWORKS_UPDATE) && (
              <button
                onClick={() => onRestore(labwork)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </button>
            )
          ) : (
            <>
              {can(Permission.LABWORKS_UPDATE) && (
                <button
                  onClick={() => onEdit(labwork)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </button>
              )}
              {can(Permission.LABWORKS_DELETE) && (
                <button
                  onClick={() => onDelete(labwork)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
