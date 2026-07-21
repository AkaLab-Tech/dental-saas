import { useState } from 'react'
import {
  Receipt,
  Calendar,
  DollarSign,
  Pencil,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Clock,
  Tag,
  ImageIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission, AttachmentModule } from '@dental/shared'
import type { Expense } from '@/lib/expense-api'
import { getExpenseStatusBadge } from '@/lib/expense-api'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { ImageGallery } from '@/components/ui/ImageGallery'

interface ExpenseCardProps {
  expense: Expense
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  onRestore?: (expense: Expense) => void
  onTogglePaid?: (expense: Expense) => void
}

export function ExpenseCard({
  expense,
  onEdit,
  onDelete,
  onRestore,
  onTogglePaid,
}: ExpenseCardProps) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const [showImages, setShowImages] = useState(false)
  const [imageRefreshKey, setImageRefreshKey] = useState(0)
  const statusBadge = getExpenseStatusBadge(expense)
  const isDeleted = !!expense.deletedAt

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
            <div className="h-12 w-12 rounded-full bg-linear-to-br from-red-500 to-red-600 flex items-center justify-center">
              <Receipt className="h-6 w-6 text-white" />
            </div>

            {/* Issuer & Date */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{expense.issuer}</h3>
              <div className="flex items-center gap-1.5 mt-0.5 text-sm text-gray-600">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span>{formatDate(expense.date)}</span>
              </div>
            </div>
          </div>

          {/* Status badge */}
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge.variant === 'success'
                ? 'bg-green-100 text-green-800'
                : statusBadge.variant === 'warning'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Amount */}
        <div className="flex items-center gap-2 mb-3 text-lg">
          <DollarSign className="h-5 w-5 text-gray-400" />
          <span className="font-bold text-gray-900">{formatCurrency(expense.amount, currency)}</span>
        </div>

        {/* Items */}
        {expense.items && expense.items.length > 0 && (
          <div className="mb-3">
            <p className="text-sm text-gray-600 line-clamp-2">
              {expense.items.join(', ')}
            </p>
          </div>
        )}

        {/* Tags */}
        {expense.tags && expense.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {expense.tags.map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs"
              >
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Payment toggle */}
        <div className="mb-4">
          <button
            onClick={() => onTogglePaid?.(expense)}
            disabled={isDeleted || !can(Permission.EXPENSES_UPDATE)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${expense.isPaid
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${isDeleted || !can(Permission.EXPENSES_UPDATE) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {expense.isPaid ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
            {expense.isPaid ? t('payment.paid') : t('payment.pending')}
          </button>
        </div>

        {/* Notes */}
        {expense.note && (
          <p className="text-sm text-gray-500 mb-4 line-clamp-2">{expense.note}</p>
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
                  module={AttachmentModule.EXPENSES}
                  entityId={expense.id}
                  onUploadComplete={() => setImageRefreshKey((k) => k + 1)}
                />
                <ImageGallery
                  module={AttachmentModule.EXPENSES}
                  entityId={expense.id}
                  refreshKey={imageRefreshKey}
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
          {isDeleted && onRestore ? (
            can(Permission.EXPENSES_UPDATE) && (
              <button
                onClick={() => onRestore(expense)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                {t('common.restore')}
              </button>
            )
          ) : (
            <>
              {can(Permission.EXPENSES_UPDATE) && (
                <button
                  onClick={() => onEdit(expense)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                  {t('common.edit')}
                </button>
              )}
              {can(Permission.EXPENSES_DELETE) && (
                <button
                  onClick={() => onDelete(expense)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('common.delete')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
