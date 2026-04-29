import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileText,
  Trash2,
  Pencil,
  Plus,
  Save,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import type {
  BudgetItem,
  BudgetItemInput,
  BudgetStatus,
  BudgetItemStatus,
} from '@/lib/budget-api'
import { getExecutedItemsCount } from '@/lib/budget-api'
import { useBudgetsStore } from '@/stores/budgets.store'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const STATUS_STYLES: Record<BudgetStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 border-gray-200',
  APPROVED: 'bg-blue-100 text-blue-700 border-blue-200',
  PARTIAL: 'bg-amber-100 text-amber-700 border-amber-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
}

const ITEM_STATUS_OPTIONS: BudgetItemStatus[] = [
  'PENDING',
  'SCHEDULED',
  'IN_PROGRESS',
  'EXECUTED',
  'CANCELLED',
]

// `PARTIAL` and `COMPLETED` are derived by the backend from item states
// (see `deriveBudgetStatus` in `budget.service.ts`) and are normalized on
// every write, so they must not appear as user-selectable options.
const USER_SETTABLE_BUDGET_STATUSES: BudgetStatus[] = [
  'DRAFT',
  'APPROVED',
  'CANCELLED',
]

const EMPTY_ITEM_INPUT: BudgetItemInput = {
  description: '',
  toothNumber: '',
  quantity: 1,
  unitPrice: 0,
}

export default function BudgetDetailPage() {
  const { t } = useTranslation()
  const { patientId, id: budgetId } = useParams<{ patientId: string; id: string }>()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const {
    currentBudget,
    loading,
    error,
    fetchBudget,
    updateBudget,
    addItem,
    updateItem,
    deleteItem,
    clearError,
  } = useBudgetsStore()

  const [metadataDraft, setMetadataDraft] = useState<{
    notes: string
    validUntil: string
    status: BudgetStatus
  } | null>(null)
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [itemDraft, setItemDraft] = useState<BudgetItemInput & { status?: BudgetItemStatus } | null>(
    null
  )
  const [newItemDraft, setNewItemDraft] = useState<BudgetItemInput>(EMPTY_ITEM_INPUT)
  const [showAddItem, setShowAddItem] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<BudgetItem | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const canUpdate = can(Permission.BUDGETS_UPDATE)

  useEffect(() => {
    if (budgetId) fetchBudget(budgetId).catch(() => {})
  }, [budgetId, fetchBudget])

  // Initialize metadata draft when budget loads
  useEffect(() => {
    if (currentBudget && metadataDraft === null) {
      setMetadataDraft({
        notes: currentBudget.notes ?? '',
        validUntil: currentBudget.validUntil
          ? currentBudget.validUntil.split('T')[0]
          : '',
        status: currentBudget.status,
      })
    }
  }, [currentBudget, metadataDraft])

  if (loading && !currentBudget) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        {t('common.loading')}
      </div>
    )
  }

  if (error && !currentBudget) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!currentBudget || !metadataDraft || !budgetId) {
    return null
  }

  const { executed, total: totalItems } = getExecutedItemsCount(currentBudget)

  const metadataDirty =
    metadataDraft.notes !== (currentBudget.notes ?? '') ||
    metadataDraft.validUntil !==
      (currentBudget.validUntil ? currentBudget.validUntil.split('T')[0] : '') ||
    metadataDraft.status !== currentBudget.status

  const handleSaveMetadata = async () => {
    setIsSavingMetadata(true)
    setActionError(null)
    try {
      await updateBudget(budgetId, {
        notes: metadataDraft.notes || null,
        validUntil: metadataDraft.validUntil || null,
        status: metadataDraft.status,
      })
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t('budgets.errors.updateFailed')
      )
    } finally {
      setIsSavingMetadata(false)
    }
  }

  const startEditItem = (item: BudgetItem) => {
    setEditingItemId(item.id)
    setItemDraft({
      description: item.description,
      toothNumber: item.toothNumber ?? '',
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      status: item.status,
    })
  }

  const cancelEditItem = () => {
    setEditingItemId(null)
    setItemDraft(null)
  }

  const handleSaveItem = async () => {
    if (!editingItemId || !itemDraft) return
    setActionLoading(true)
    setActionError(null)
    try {
      await updateItem(budgetId, editingItemId, {
        description: itemDraft.description,
        toothNumber: itemDraft.toothNumber?.trim() ? itemDraft.toothNumber.trim() : null,
        quantity: Number(itemDraft.quantity),
        unitPrice: Number(itemDraft.unitPrice),
        status: itemDraft.status,
      })
      cancelEditItem()
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t('budgets.errors.itemUpdateFailed')
      )
    } finally {
      setActionLoading(false)
    }
  }

  const handleAddItem = async () => {
    setActionLoading(true)
    setActionError(null)
    try {
      await addItem(budgetId, {
        description: newItemDraft.description,
        toothNumber: newItemDraft.toothNumber?.trim() ? newItemDraft.toothNumber.trim() : null,
        quantity: Number(newItemDraft.quantity),
        unitPrice: Number(newItemDraft.unitPrice),
      })
      setNewItemDraft(EMPTY_ITEM_INPUT)
      setShowAddItem(false)
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t('budgets.errors.itemCreateFailed')
      )
    } finally {
      setActionLoading(false)
    }
  }

  const handleConfirmDeleteItem = async () => {
    if (!itemToDelete) return
    setActionLoading(true)
    setActionError(null)
    try {
      await deleteItem(budgetId, itemToDelete.id)
      setItemToDelete(null)
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t('budgets.errors.itemDeleteFailed')
      )
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Breadcrumb */}
      <Link
        to={`/patients/${patientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {formatCurrency(Number(currentBudget.totalAmount), currency)}
              </h1>
              <p className="text-sm text-gray-600 mt-0.5">
                {t('budgets.itemsProgress', { executed, total: totalItems })}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${STATUS_STYLES[currentBudget.status]}`}
          >
            {t(`budgets.status.${currentBudget.status}`)}
          </span>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              clearError()
            }}
            className="text-red-700 hover:text-red-900"
          >
            ×
          </button>
        </div>
      )}

      {/* Metadata card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t('budgets.notes')}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('budgets.validUntil')}
            </label>
            <input
              type="date"
              value={metadataDraft.validUntil}
              disabled={!canUpdate}
              onChange={(e) =>
                setMetadataDraft({ ...metadataDraft, validUntil: e.target.value })
              }
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('common.status') /* fallback; we use budget status next */}
            </label>
            <select
              value={metadataDraft.status}
              disabled={!canUpdate}
              onChange={(e) =>
                setMetadataDraft({
                  ...metadataDraft,
                  status: e.target.value as BudgetStatus,
                })
              }
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
            >
              {!USER_SETTABLE_BUDGET_STATUSES.includes(currentBudget.status) && (
                <option value={currentBudget.status} disabled>
                  {t(`budgets.status.${currentBudget.status}`)}
                </option>
              )}
              {USER_SETTABLE_BUDGET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`budgets.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('budgets.notes')}
            </label>
            <textarea
              rows={3}
              value={metadataDraft.notes}
              disabled={!canUpdate}
              placeholder={t('budgets.notesPlaceholder')}
              onChange={(e) =>
                setMetadataDraft({ ...metadataDraft, notes: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          {canUpdate && metadataDirty && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveMetadata}
                disabled={isSavingMetadata}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingMetadata ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t('common.save')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Items card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('budgets.items.title')}
          </h2>
          {canUpdate && !showAddItem && (
            <button
              type="button"
              onClick={() => setShowAddItem(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-4 w-4" />
              {t('budgets.items.addItem')}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {currentBudget.items.map((item) => {
            const isEditing = editingItemId === item.id
            if (isEditing && itemDraft) {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-blue-200 bg-blue-50/40 p-3"
                >
                  <div className="grid grid-cols-12 gap-3">
                    <input
                      type="text"
                      value={itemDraft.description}
                      onChange={(e) =>
                        setItemDraft({ ...itemDraft, description: e.target.value })
                      }
                      placeholder={t('budgets.items.descriptionPlaceholder')}
                      className="col-span-12 sm:col-span-5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={itemDraft.toothNumber ?? ''}
                      onChange={(e) =>
                        setItemDraft({ ...itemDraft, toothNumber: e.target.value })
                      }
                      placeholder={t('budgets.items.toothNumberPlaceholder')}
                      className="col-span-4 sm:col-span-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={itemDraft.quantity}
                      onChange={(e) =>
                        setItemDraft({ ...itemDraft, quantity: Number(e.target.value) })
                      }
                      className="col-span-4 sm:col-span-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={itemDraft.unitPrice}
                      onChange={(e) =>
                        setItemDraft({ ...itemDraft, unitPrice: Number(e.target.value) })
                      }
                      className="col-span-4 sm:col-span-3 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                    <select
                      value={itemDraft.status}
                      onChange={(e) =>
                        setItemDraft({
                          ...itemDraft,
                          status: e.target.value as BudgetItemStatus,
                        })
                      }
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-sm"
                    >
                      {ITEM_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {t(`budgets.itemStatus.${s}`)}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={cancelEditItem}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveItem}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {t('common.save')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={item.id}
                className="rounded-lg border border-gray-200 p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{item.description}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[
                        item.status === 'PENDING' || item.status === 'SCHEDULED'
                          ? 'DRAFT'
                          : item.status === 'EXECUTED'
                          ? 'COMPLETED'
                          : item.status === 'CANCELLED'
                          ? 'CANCELLED'
                          : 'APPROVED'
                      ]}`}
                    >
                      {t(`budgets.itemStatus.${item.status}`)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-3">
                    {item.toothNumber && (
                      <span>
                        {t('budgets.items.toothNumber')}: {item.toothNumber}
                      </span>
                    )}
                    <span>
                      {item.quantity} × {formatCurrency(Number(item.unitPrice), currency)} ={' '}
                      <strong>{formatCurrency(Number(item.totalPrice), currency)}</strong>
                    </span>
                  </div>
                </div>
                {canUpdate && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => startEditItem(item)}
                      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      aria-label={t('common.edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {currentBudget.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItemToDelete(item)}
                        className="rounded-md p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                        aria-label={t('budgets.items.removeItem')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {showAddItem && canUpdate && (
            <div className="rounded-lg border border-green-200 bg-green-50/40 p-3">
              <div className="grid grid-cols-12 gap-3">
                <input
                  type="text"
                  value={newItemDraft.description}
                  onChange={(e) =>
                    setNewItemDraft({ ...newItemDraft, description: e.target.value })
                  }
                  placeholder={t('budgets.items.descriptionPlaceholder')}
                  className="col-span-12 sm:col-span-5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                />
                <input
                  type="text"
                  value={newItemDraft.toothNumber ?? ''}
                  onChange={(e) =>
                    setNewItemDraft({ ...newItemDraft, toothNumber: e.target.value })
                  }
                  placeholder={t('budgets.items.toothNumberPlaceholder')}
                  className="col-span-4 sm:col-span-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={newItemDraft.quantity}
                  onChange={(e) =>
                    setNewItemDraft({ ...newItemDraft, quantity: Number(e.target.value) })
                  }
                  className="col-span-4 sm:col-span-2 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newItemDraft.unitPrice}
                  onChange={(e) =>
                    setNewItemDraft({ ...newItemDraft, unitPrice: Number(e.target.value) })
                  }
                  className="col-span-4 sm:col-span-3 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="flex justify-end mt-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddItem(false)
                    setNewItemDraft(EMPTY_ITEM_INPUT)
                  }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleAddItem}
                  disabled={actionLoading || !newItemDraft.description.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {t('budgets.items.addItem')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!itemToDelete}
        onClose={() => !actionLoading && setItemToDelete(null)}
        onConfirm={handleConfirmDeleteItem}
        title={t('budgets.items.removeItem')}
        message={t('budgets.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={actionLoading}
      />
    </div>
  )
}
