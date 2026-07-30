import { useEffect, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CreateBudgetData } from '@/lib/budget-api'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'

// ============================================================================
// Validation Schema
// ============================================================================

const budgetItemSchema = z.object({
  description: z.string().min(1, 'descriptionRequired'),
  toothNumber: z.string().max(5).optional(),
  quantity: z.coerce.number().int().min(1, 'quantityInvalid'),
  unitPrice: z.coerce.number().min(0, 'unitPriceInvalid'),
  notes: z.string().max(2000).optional(),
})

const budgetFormSchema = z.object({
  notes: z.string().max(2000).optional(),
  validUntil: z.string().optional(),
  items: z.array(budgetItemSchema).min(1, 'minOneItem'),
})

type BudgetFormData = z.infer<typeof budgetFormSchema>

// ============================================================================
// Props
// ============================================================================

interface BudgetFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateBudgetData) => Promise<void>
  isLoading?: boolean
  error?: string | null
}

const EMPTY_ITEM = { description: '', toothNumber: '', quantity: 1, unitPrice: 0, notes: '' }

export function BudgetFormModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
  error = null,
}: BudgetFormModalProps) {
  const { t } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BudgetFormData>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      notes: '',
      validUntil: '',
      items: [EMPTY_ITEM],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  // Reset to a clean state every time the modal opens (create-only)
  useEffect(() => {
    if (isOpen) {
      reset({ notes: '', validUntil: '', items: [EMPTY_ITEM] })
    }
  }, [isOpen, reset])

  // Live total for the footer
  const watchedItems = watch('items')
  const total = (watchedItems || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unitPrice) || 0
    return sum + qty * price
  }, 0)

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

  const handleFormSubmit = async (data: BudgetFormData) => {
    const payload: CreateBudgetData = {
      ...(data.notes ? { notes: data.notes } : {}),
      ...(data.validUntil ? { validUntil: data.validUntil } : {}),
      items: data.items.map((item, idx) => ({
        description: item.description,
        toothNumber: item.toothNumber?.trim() ? item.toothNumber.trim() : null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes?.trim() ? item.notes.trim() : null,
        order: idx,
      })),
    }
    await onSubmit(payload)
  }

  const translateItemError = (key?: string) => (key ? t(`budgets.errors.${key}`) : '')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl my-4">
          <form noValidate onSubmit={handleSubmit(handleFormSubmit)}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                {t('budgets.newBudget')}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isLoading}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {/* Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="budget-validUntil"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('budgets.validUntil')}
                  </label>
                  <input
                    id="budget-validUntil"
                    type="date"
                    {...register('validUntil')}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="budget-notes"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('budgets.notes')}
                </label>
                <textarea
                  id="budget-notes"
                  rows={2}
                  placeholder={t('budgets.notesPlaceholder')}
                  {...register('notes')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Items */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {t('budgets.items.title')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => append(EMPTY_ITEM)}
                    disabled={isSubmitting || isLoading}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    {t('budgets.items.addItem')}
                  </button>
                </div>

                {errors.items?.root && (
                  <p className="text-sm text-red-600 mb-2">
                    {translateItemError(errors.items.root.message)}
                  </p>
                )}

                <div className="space-y-3">
                  {fields.map((field, index) => {
                    const itemErrors = errors.items?.[index]
                    const qty = Number(watchedItems?.[index]?.quantity) || 0
                    const price = Number(watchedItems?.[index]?.unitPrice) || 0
                    const lineTotal = qty * price
                    return (
                      <div
                        key={field.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="grid grid-cols-12 gap-3 items-start">
                          <div className="col-span-12 sm:col-span-5">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {t('budgets.items.description')}
                            </label>
                            <input
                              type="text"
                              placeholder={t('budgets.items.descriptionPlaceholder')}
                              {...register(`items.${index}.description`)}
                              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {itemErrors?.description && (
                              <p className="text-xs text-red-600 mt-1">
                                {translateItemError(itemErrors.description.message)}
                              </p>
                            )}
                          </div>

                          <div className="col-span-4 sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {t('budgets.items.toothNumber')}
                            </label>
                            <input
                              type="text"
                              placeholder={t('budgets.items.toothNumberPlaceholder')}
                              {...register(`items.${index}.toothNumber`)}
                              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div className="col-span-4 sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {t('budgets.items.quantity')}
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              {...register(`items.${index}.quantity`)}
                              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {itemErrors?.quantity && (
                              <p className="text-xs text-red-600 mt-1">
                                {translateItemError(itemErrors.quantity.message)}
                              </p>
                            )}
                          </div>

                          <div className="col-span-4 sm:col-span-3">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {t('budgets.items.unitPrice')}
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              {...register(`items.${index}.unitPrice`)}
                              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {itemErrors?.unitPrice && (
                              <p className="text-xs text-red-600 mt-1">
                                {translateItemError(itemErrors.unitPrice.message)}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm text-gray-700">
                            {t('budgets.items.totalPrice')}:{' '}
                            <span className="font-medium">
                              {formatCurrency(lineTotal, currency)}
                            </span>
                          </span>
                          {fields.length > 1 && (
                            <button
                              type="button"
                              onClick={() => remove(index)}
                              disabled={isSubmitting || isLoading}
                              className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                              aria-label={t('budgets.items.removeItem')}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t('budgets.items.removeItem')}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-4 p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <div className="text-sm text-gray-700">
                {t('budgets.total')}:{' '}
                <span className="text-lg font-semibold text-gray-900">
                  {formatCurrency(total, currency)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting || isLoading}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {(isSubmitting || isLoading) && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t('common.save')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
