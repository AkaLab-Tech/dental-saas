import { useEffect, useCallback, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, Plus, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Expense, CreateExpenseData } from '@/lib/expense-api'
import { formatDateForInput } from '@/lib/format'

// ============================================================================
// Validation Schema
// ============================================================================

const expenseFormSchema = z.object({
  issuer: z.string().min(1, 'El proveedor es requerido'),
  date: z.string().min(1, 'La fecha es requerida'),
  amount: z.coerce.number().min(0.01, 'El monto debe ser mayor a 0'),
  items: z.array(z.object({ value: z.string() })).optional(),
  tags: z.array(z.object({ value: z.string() })).optional(),
  isPaid: z.boolean().optional(),
  note: z.string().max(2000, 'Las notas no pueden exceder 2000 caracteres').optional(),
})

type ExpenseFormData = z.infer<typeof expenseFormSchema>

// ============================================================================
// Main Component
// ============================================================================

interface ExpenseFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateExpenseData) => Promise<void>
  expense?: Expense | null
  isLoading?: boolean
}

export function ExpenseFormModal({
  isOpen,
  onClose,
  onSubmit,
  expense,
  isLoading = false,
}: ExpenseFormModalProps) {
  const { t } = useTranslation()
  const isEditing = !!expense
  const [newTag, setNewTag] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      issuer: '',
      date: formatDateForInput(new Date()),
      amount: 0,
      items: [{ value: '' }],
      tags: [],
      isPaid: false,
      note: '',
    },
  })

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control,
    name: 'items',
  })

  const { fields: tagFields, append: appendTag, remove: removeTag } = useFieldArray({
    control,
    name: 'tags',
  })

  // Reset form when expense changes or modal opens
  useEffect(() => {
    if (isOpen) {
      if (expense) {
        const items = expense.items && expense.items.length > 0
          ? expense.items.map(item => ({ value: item }))
          : [{ value: '' }]
        const tags = expense.tags && expense.tags.length > 0
          ? expense.tags.map(tag => ({ value: tag }))
          : []

        reset({
          issuer: expense.issuer,
          date: expense.date.split('T')[0],
          amount: expense.amount,
          items,
          tags,
          isPaid: expense.isPaid,
          note: expense.note || '',
        })
      } else {
        reset({
          issuer: '',
          date: formatDateForInput(new Date()),
          amount: 0,
          items: [{ value: '' }],
          tags: [],
          isPaid: false,
          note: '',
        })
      }
      setNewTag('')
    }
  }, [isOpen, expense, reset])

  const handleFormSubmit = async (data: ExpenseFormData) => {
    const items = data.items?.map(i => i.value).filter(v => v.trim() !== '') || []
    const tags = data.tags?.map(t => t.value).filter(v => v.trim() !== '') || []

    const submitData: CreateExpenseData = {
      issuer: data.issuer,
      date: data.date,
      amount: data.amount,
      isPaid: data.isPaid ?? false,
      ...(items.length > 0 && { items }),
      ...(tags.length > 0 && { tags }),
      ...(data.note && { note: data.note }),
    }

    await onSubmit(submitData)
  }

  const handleAddTag = () => {
    if (newTag.trim()) {
      appendTag({ value: newTag.trim() })
      setNewTag('')
    }
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

  const modalTitleId = 'expense-form-modal-title'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

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
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 id={modalTitleId} className="text-xl font-semibold text-gray-900">
              {isEditing ? t('expenses.editExpense') : t('expenses.newExpense')}
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
            <div className="p-6 space-y-5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {/* Issuer */}
              <div>
                <label htmlFor="issuer" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('expenses.issuerLabel')} <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('issuer')}
                  type="text"
                  id="issuer"
                  placeholder={t('expenses.issuerPlaceholder')}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.issuer ? 'border-red-300' : 'border-gray-300'
                    }`}
                />
                {errors.issuer && <p className="mt-1 text-sm text-red-500">{errors.issuer.message}</p>}
              </div>

              {/* Date and Amount row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('expenses.dateLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('date')}
                    type="date"
                    id="date"
                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.date ? 'border-red-300' : 'border-gray-300'
                      }`}
                  />
                  {errors.date && <p className="mt-1 text-sm text-red-500">{errors.date.message}</p>}
                </div>

                <div>
                  <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('expenses.amountLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('amount')}
                    type="number"
                    id="amount"
                    min="0"
                    step="0.01"
                    placeholder={t('expenses.amountPlaceholder')}
                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.amount ? 'border-red-300' : 'border-gray-300'
                      }`}
                  />
                  {errors.amount && <p className="mt-1 text-sm text-red-500">{errors.amount.message}</p>}
                </div>
              </div>

              {/* Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('expenses.itemsLabel')}
                </label>
                <div className="space-y-2">
                  {itemFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2">
                      <input
                        {...register(`items.${index}.value`)}
                        type="text"
                        placeholder={t('expenses.itemPlaceholder')}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {itemFields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <Minus className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => appendItem({ value: '' })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <Plus className="h-4 w-4" />
                    {t('expenses.addItem')}
                  </button>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('expenses.tagsLabel')}
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tagFields.map((field, index) => (
                    <span
                      key={field.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                    >
                      {/* eslint-disable-next-line react-hooks/incompatible-library */}
                      {watch(`tags.${index}.value`)}
                      <button
                        type="button"
                        onClick={() => removeTag(index)}
                        className="hover:text-blue-900"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag()
                      }
                    }}
                    placeholder={t('expenses.newTagPlaceholder')}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Paid checkbox */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    {...register('isPaid')}
                    type="checkbox"
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{t('payment.paid')}</span>
                </label>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="note" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('expenses.notesLabel')}
                </label>
                <textarea
                  {...register('note')}
                  id="note"
                  rows={3}
                  placeholder={t('expenses.notesPlaceholder')}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${errors.note ? 'border-red-300' : 'border-gray-300'
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
                {isEditing ? t('expenses.saveChanges') : t('expenses.createExpense')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
