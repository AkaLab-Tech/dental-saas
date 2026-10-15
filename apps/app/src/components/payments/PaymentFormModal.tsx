import { useEffect, useCallback, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CreatePaymentData } from '@/lib/payment-api'
import { listBudgetsByPatient, type Budget } from '@/lib/budget-api'
import { formatDateForInput, formatShortDate } from '@/lib/format'

// ============================================================================
// Validation Schema
// ============================================================================

// Mirrors what createPayment accepts for a reservation: a budget of this
// patient that is active and neither COMPLETED nor CANCELLED.
function isReservableBudget(budget: Budget, patientId: string): boolean {
  return (
    budget.patientId === patientId &&
    budget.isActive &&
    budget.status !== 'COMPLETED' &&
    budget.status !== 'CANCELLED'
  )
}

function createPaymentSchema(
  maxAmount?: number,
  reservableBudgetIds: string[] = [],
  budgetMessage = 'Presupuesto no disponible'
) {
  let amount = z.coerce.number().min(0.01, 'El monto debe ser mayor a 0')
  if (maxAmount !== undefined) {
    amount = amount.max(maxAmount, `El monto no puede exceder ${maxAmount}`)
  }
  return z.object({
    amount,
    date: z.string().min(1, 'La fecha es requerida'),
    note: z.string().max(1000).optional(),
    // Dead defence TODAY, kept on purpose. No UI path reaches it: when an
    // option disappears the select reads '' and the stale-id effect drops the
    // value before submit, so removing this .refine leaves every test green.
    // It becomes live the moment the form can hold a budgetId absent from
    // reservableBudgetIds — a programmatic setValue, a second writer of this
    // form state, or dropping that clearing effect. Do NOT read it as the
    // active guard for the stale-picker race: that is the clearing effect plus
    // the 404/400 handling in PaymentSection.
    budgetId: z
      .string()
      .optional()
      .refine((id) => !id || reservableBudgetIds.includes(id), budgetMessage),
  })
}

type PaymentFormData = z.infer<ReturnType<typeof createPaymentSchema>>

/**
 * This patient's budgets as the form needs them: the ones an advance can be
 * reserved to, and how many they have at all. The count is the only thing that
 * tells "no budget yet" from "every budget closed".
 */
interface BudgetOptions {
  reservable: Budget[]
  ownedCount: number
}

// ============================================================================
// Main Component
// ============================================================================

interface PaymentFormModalProps {
  isOpen: boolean
  onClose: () => void
  /** Resolves to false when the request failed (the modal stays open). */
  onSubmit: (data: CreatePaymentData) => Promise<boolean | void>
  maxAmount?: number
  /** When given, the form offers to reserve the advance to one of this patient's open budgets. */
  patientId?: string
  formatCurrency: (amount: number) => string
  isLoading?: boolean
}

export function PaymentFormModal({
  isOpen,
  onClose,
  onSubmit,
  maxAmount,
  patientId,
  formatCurrency,
  isLoading = false,
}: PaymentFormModalProps) {
  const { t, i18n } = useTranslation()
  // null while the list has not been read (loading, failure, or no patientId).
  // Branching on the fetch OUTCOME is what lets ownedCount === 0 mean "this
  // patient has no budget" and never "we do not know yet".
  const [budgetOptions, setBudgetOptions] = useState<BudgetOptions | null>(null)
  const [budgetsRefreshKey, setBudgetsRefreshKey] = useState(0)
  // Memoised so the stale-pick clearing effect below keeps firing on a real
  // change of options, not on every render.
  const budgets = useMemo(() => budgetOptions?.reservable ?? [], [budgetOptions])

  useEffect(() => {
    if (!isOpen || !patientId) {
      setBudgetOptions(null)
      return
    }
    let cancelled = false
    listBudgetsByPatient(patientId, { limit: 100 })
      .then(({ data }) => {
        const owned = data.filter((b) => b.patientId === patientId)
        if (!cancelled) {
          setBudgetOptions({
            reservable: owned.filter((b) => isReservableBudget(b, patientId)),
            ownedCount: owned.length,
          })
        }
      })
      .catch(() => {
        // The reservation is optional: without the list the form neither
        // offers it nor claims anything about this patient's budgets, and the
        // advance is recorded as a general one.
        if (!cancelled) setBudgetOptions(null)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, patientId, budgetsRefreshKey])

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(
      createPaymentSchema(
        maxAmount,
        budgets.map((b) => b.id),
        t('payments.form.budgetNotOpen')
      )
    ),
    defaultValues: {
      amount: 0,
      date: formatDateForInput(new Date()),
      note: '',
      budgetId: '',
    },
  })

  useEffect(() => {
    if (isOpen) {
      reset({
        amount: 0,
        date: formatDateForInput(new Date()),
        note: '',
        budgetId: '',
      })
    }
  }, [isOpen, reset])

  const handleFormSubmit = async (data: PaymentFormData) => {
    const ok = await onSubmit({
      amount: data.amount,
      date: data.date,
      note: data.note || undefined,
      budgetId: data.budgetId || undefined,
    })
    // A reserved submit that failed may have raced a budget closed or
    // deactivated elsewhere: reload the options instead of keeping a stale pick.
    if (ok === false && data.budgetId) setBudgetsRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    const selected = getValues('budgetId')
    if (selected && !budgets.some((b) => b.id === selected)) setValue('budgetId', '')
  }, [budgets, getValues, setValue])

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

              {/* Task #571, DECIDED (not inherited): with no budget to reserve
                  to the picker stays absent, but the absence is explained and
                  the two reasons are told apart — "no budget yet" and "every
                  budget closed" call for different actions. Shown only once the
                  list was really read: a failed fetch says nothing about this
                  patient's budgets. */}
              {budgetOptions !== null && budgets.length === 0 && (
                <p
                  data-testid={
                    budgetOptions.ownedCount === 0
                      ? 'payment-budget-no-budgets'
                      : 'payment-budget-all-closed'
                  }
                  className="text-xs text-gray-500"
                >
                  {budgetOptions.ownedCount === 0
                    ? t('payments.form.budgetNoneExist')
                    : t('payments.form.budgetAllClosed')}
                </p>
              )}

              {/* Budget reservation: only offered when there is a budget to reserve to */}
              {budgets.length > 0 && (
                <div>
                  <label htmlFor="payment-budget" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('payments.form.budget')}
                  </label>
                  <select
                    {...register('budgetId')}
                    id="payment-budget"
                    className={`w-full px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.budgetId ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    <option value="">{t('payments.form.budgetNone')}</option>
                    {budgets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {t('budgets.createdOn', {
                          date: formatShortDate(b.createdAt, i18n.language),
                        })}{' '}
                        - {formatCurrency(Number(b.totalAmount))}
                      </option>
                    ))}
                  </select>
                  {errors.budgetId ? (
                    <p className="mt-1 text-sm text-red-500">{errors.budgetId.message}</p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">{t('payments.form.budgetHint')}</p>
                  )}
                </div>
              )}
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
