import { useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CreatePaymentData } from '@/lib/payment-api'
import { formatDateForInput } from '@/lib/format'

// ============================================================================
// Validation Schema
// ============================================================================

function createPaymentSchema(maxAmount?: number) {
  let amount = z.coerce.number().min(0.01, 'El monto debe ser mayor a 0')
  if (maxAmount !== undefined) {
    amount = amount.max(maxAmount, `El monto no puede exceder ${maxAmount}`)
  }
  return z.object({
    amount,
    date: z.string().min(1, 'La fecha es requerida'),
    note: z.string().max(1000).optional(),
  })
}

type PaymentFormData = z.infer<ReturnType<typeof createPaymentSchema>>

// ============================================================================
// Main Component
// ============================================================================

interface PaymentFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreatePaymentData) => Promise<void>
  maxAmount?: number
  formatCurrency: (amount: number) => string
  isLoading?: boolean
}

export function PaymentFormModal({
  isOpen,
  onClose,
  onSubmit,
  maxAmount,
  formatCurrency,
  isLoading = false,
}: PaymentFormModalProps) {
  const { t } = useTranslation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(createPaymentSchema(maxAmount)),
    defaultValues: {
      amount: 0,
      date: formatDateForInput(new Date()),
      note: '',
    },
  })

  useEffect(() => {
    if (isOpen) {
      reset({
        amount: 0,
        date: formatDateForInput(new Date()),
        note: '',
      })
    }
  }, [isOpen, reset])

  const handleFormSubmit = async (data: PaymentFormData) => {
    await onSubmit({
      amount: data.amount,
      date: data.date,
      note: data.note || undefined,
    })
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isLoading) {
        onClose()
      }
    },
    [onClose, isSubmitting, isLoading]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const modalTitleId = 'payment-form-modal-title'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="relative w-full max-w-md bg-white rounded-xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 id={modalTitleId} className="text-xl font-semibold text-gray-900">
              {t('payments.newPayment')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isLoading}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Form */}
          <form noValidate onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="p-6 space-y-5">
              {/* Amount and Date row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="payment-amount" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('payments.form.amount')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('amount')}
                    type="number"
                    id="payment-amount"
                    min="0.01"
                    {...(maxAmount !== undefined ? { max: maxAmount } : {})}
                    step="0.01"
                    placeholder="0.00"
                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.amount ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                  {errors.amount ? (
                    <p className="mt-1 text-sm text-red-500">{errors.amount.message}</p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      {maxAmount !== undefined
                        ? t('payments.form.amountHint', { max: formatCurrency(maxAmount) })
                        : t('payments.form.advanceHint')}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="payment-date" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('payments.form.date')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('date')}
                    type="date"
                    id="payment-date"
                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.date ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                  {errors.date && <p className="mt-1 text-sm text-red-500">{errors.date.message}</p>}
                </div>
              </div>

              {/* Note */}
              <div>
                <label htmlFor="payment-note" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('payments.form.note')}
                </label>
                <textarea
                  {...register('note')}
                  id="payment-note"
                  rows={2}
                  placeholder={t('payments.form.notePlaceholder')}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                    errors.note ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.note && <p className="mt-1 text-sm text-red-500">{errors.note.message}</p>}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isLoading}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {(isSubmitting || isLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
