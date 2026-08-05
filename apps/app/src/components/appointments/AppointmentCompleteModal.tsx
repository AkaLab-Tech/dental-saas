import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2, CheckCircle, AlertCircle, ClipboardList } from 'lucide-react'
import {
  getAppointmentBudgetItems,
  getAppointmentApiErrorMessage,
  type AppointmentBudgetItemSummary,
} from '@/lib/appointment-api'
import { useAppointmentsStore } from '@/stores/appointments.store'
import { formatCurrency } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'

interface AppointmentCompleteModalProps {
  isOpen: boolean
  appointmentId: string | null
  onClose: () => void
  onCompleted?: () => void
}

export function AppointmentCompleteModal({
  isOpen,
  appointmentId,
  onClose,
  onCompleted,
}: AppointmentCompleteModalProps) {
  const { t } = useTranslation()
  const modalTitleId = useId()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const completeAppointment = useAppointmentsStore((s) => s.completeAppointment)

  const [items, setItems] = useState<AppointmentBudgetItemSummary[]>([])
  const [executedItemIds, setExecutedItemIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load associated budget items whenever the modal opens for a given appointment
  useEffect(() => {
    if (!isOpen || !appointmentId) {
      setItems([])
      setExecutedItemIds([])
      setNotes('')
      setError(null)
      return
    }

    let cancelled = false
    setIsLoadingItems(true)
    setError(null)

    getAppointmentBudgetItems(appointmentId)
      .then((data) => {
        if (cancelled) return
        setItems(data)
        // Default ON — every still-SCHEDULED item is assumed executed; the
        // doctor opts individual items OUT rather than opting each one in
        // (opt-in defaults left items stuck SCHEDULED forever in practice).
        setExecutedItemIds(
          data.filter((item) => item.roles.includes('SCHEDULED') && !item.roles.includes('EXECUTED')).map((item) => item.id)
        )
      })
      .catch((e) => {
        if (cancelled) return
        setError(getAppointmentApiErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingItems(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, appointmentId])

  if (!isOpen) return null

  const scheduledItems = items.filter((item) => item.roles.includes('SCHEDULED') && !item.roles.includes('EXECUTED'))
  const alreadyExecutedItems = items.filter((item) => item.roles.includes('EXECUTED'))

  const toggleItem = (itemId: string) => {
    setExecutedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    )
  }

  const handleConfirm = async () => {
    if (!appointmentId) return
    setIsSubmitting(true)
    setError(null)
    try {
      await completeAppointment(appointmentId, notes || undefined, executedItemIds)
      onCompleted?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : getAppointmentApiErrorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="relative w-full max-w-lg bg-white rounded-xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 id={modalTitleId} className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              {t('appointments.complete.title')}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              disabled={isSubmitting}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="px-6 py-4 space-y-4 max-h-[calc(100vh-260px)] overflow-y-auto">
            {/* Budget items */}
            <div>
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                <ClipboardList className="h-4 w-4" />
                {t('appointments.complete.itemsTitle')}
              </label>

              {isLoadingItems ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('appointments.budgetItems.loading')}
                </div>
              ) : scheduledItems.length === 0 && alreadyExecutedItems.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-1">{t('appointments.complete.noItems')}</p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                  {scheduledItems.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={executedItemIds.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{item.description}</span>
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">
                          {item.toothNumber && `${t('budgets.items.toothNumber')}: ${item.toothNumber} · `}
                          {formatCurrency(Number(item.totalPrice), currency)}
                        </span>
                        <span className="block text-xs text-gray-600 mt-0.5">
                          {t('appointments.complete.executedLabel')}
                        </span>
                      </span>
                    </label>
                  ))}

                  {alreadyExecutedItems.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 px-3 py-2 opacity-60">
                      <input type="checkbox" checked disabled className="mt-0.5 w-4 h-4 text-gray-400 border-gray-300 rounded" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-700">{item.description}</span>
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                            {t('appointments.complete.alreadyExecuted')}
                          </span>
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">
                          {item.toothNumber && `${t('budgets.items.toothNumber')}: ${item.toothNumber} · `}
                          {formatCurrency(Number(item.totalPrice), currency)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="appointment-complete-notes" className="block text-sm font-medium text-gray-700 mb-1">
                {t('appointments.complete.notesLabel')}
              </label>
              <textarea
                id="appointment-complete-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none disabled:bg-gray-100"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 rounded-b-xl border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || isLoadingItems}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('appointments.complete.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppointmentCompleteModal
