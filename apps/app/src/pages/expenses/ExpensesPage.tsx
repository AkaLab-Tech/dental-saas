import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Search,
  AlertCircle,
  Receipt,
  Loader2,
  X,
  Filter,
  DollarSign,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import { useExpensesStore } from '@/stores/expenses.store'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { ExpenseCard } from '@/components/expenses/ExpenseCard'
import { ExpenseFormModal } from '@/components/expenses/ExpenseFormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Can } from '@/components/auth'
import type { Expense, CreateExpenseData, UpdateExpenseData } from '@/lib/expense-api'

export function ExpensesPage() {
  const { t } = useTranslation()
  const {
    expenses,
    stats,
    total,
    loading,
    error,
    filters,
    fetchExpenses,
    fetchStats,
    createExpense,
    updateExpense,
    deleteExpense,
    restoreExpense,
    setFilters,
    clearError,
  } = useExpensesStore()

  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch expenses on mount
  useEffect(() => {
    fetchExpenses()
    fetchStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExpenses({ search: searchQuery || undefined })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Re-fetch when filters change
  useEffect(() => {
    fetchExpenses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleOpenCreate = () => {
    setSelectedExpense(null)
    setIsFormOpen(true)
  }

  const handleEdit = (expense: Expense) => {
    setSelectedExpense(expense)
    setIsFormOpen(true)
  }

  const handleDelete = (expense: Expense) => {
    setExpenseToDelete(expense)
  }

  const handleRestore = async (expense: Expense) => {
    try {
      await restoreExpense(expense.id)
      setSuccessMessage(t('expenses.toast.restored'))
    } catch {
      // Error is handled by store
    }
  }

  const handleTogglePaid = async (expense: Expense) => {
    try {
      await updateExpense(expense.id, { isPaid: !expense.isPaid })
    } catch {
      // Error is handled by store
    }
  }

  const handleFormSubmit = useCallback(
    async (data: CreateExpenseData) => {
      try {
        if (selectedExpense) {
          await updateExpense(selectedExpense.id, data as UpdateExpenseData)
          setSuccessMessage(t('expenses.toast.updated'))
        } else {
          await createExpense(data)
          setSuccessMessage(t('expenses.toast.created'))
        }
        setIsFormOpen(false)
        setSelectedExpense(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedExpense, createExpense, updateExpense, t]
  )

  const handleConfirmDelete = async () => {
    if (!expenseToDelete) return
    setIsDeleting(true)
    try {
      await deleteExpense(expenseToDelete.id)
      setSuccessMessage(t('expenses.toast.deleted'))
      setExpenseToDelete(null)
    } catch {
      // Error is handled by store
    } finally {
      setIsDeleting(false)
    }
  }

  const handleFilterChange = (key: 'isPaid', value: boolean | undefined) => {
    setFilters({ [key]: value })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('expenses.title')}</h1>
          <p className="text-gray-600 mt-1">
            {t('expenses.subtitle')}
            {stats && (
              <span className="text-gray-500 ml-1">
                ({stats.total} gastos, {formatCurrency(stats.totalAmount || 0, currency)})
              </span>
            )}
          </p>
        </div>

        <Can permission={Permission.EXPENSES_CREATE}>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            {t('expenses.newExpense')}
          </button>
        </Can>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <Receipt className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{t('expenses.stats.total')}</p>
                <p className="text-xl font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{t('expenses.stats.unpaid')}</p>
                <p className="text-xl font-semibold text-gray-900">{stats.unpaid}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{t('expenses.stats.paid')}</p>
                <p className="text-xl font-semibold text-gray-900">{stats.paid}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{t('expenses.stats.totalAmount')}</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatCurrency(stats.totalAmount || 0, currency)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('expenses.searchPlaceholder')}
            className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 border rounded-lg transition-colors ${showFilters || filters.isPaid !== undefined
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
        >
          <Filter className="h-5 w-5" />
          {t('common.filter')}
        </button>
      </div>

      {/* Filter options */}
      {showFilters && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('expenses.paymentStatus')}</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleFilterChange('isPaid', undefined)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === undefined
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {t('common.all')}
              </button>
              <button
                onClick={() => handleFilterChange('isPaid', true)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === true
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {t('expenses.stats.paid')}
              </button>
              <button
                onClick={() => handleFilterChange('isPaid', false)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === false
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {t('expenses.pendingFilter')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <Receipt className="h-5 w-5 text-green-600" />
          <p className="text-green-800">{successMessage}</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-800">{error}</p>
            <button onClick={clearError} className="text-sm text-red-600 hover:underline mt-1">
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && expenses.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && expenses.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Receipt className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('expenses.noExpenses')}</h3>
          <p className="text-gray-600 mb-4">
            {searchQuery || filters.isPaid !== undefined
              ? t('expenses.emptyState.filtered')
              : t('expenses.emptyState.hint')}
          </p>
          {!searchQuery && filters.isPaid === undefined && (
            <Can permission={Permission.EXPENSES_CREATE}>
              <button
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                {t('expenses.createExpense')}
              </button>
            </Can>
          )}
        </div>
      )}

      {/* Expenses grid */}
      {expenses.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {expenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              expense={expense}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onTogglePaid={handleTogglePaid}
            />
          ))}
        </div>
      )}

      {/* Pagination info */}
      {total > expenses.length && (
        <div className="text-center text-sm text-gray-500">
          {t('expenses.pagination', { shown: expenses.length, total })}
        </div>
      )}

      {/* Form Modal */}
      <ExpenseFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setSelectedExpense(null)
        }}
        onSubmit={handleFormSubmit}
        expense={selectedExpense}
        isLoading={loading}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!expenseToDelete}
        onClose={() => setExpenseToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('expenses.deleteExpense')}
        message={t('expenses.deleteConfirmMessage', { issuer: expenseToDelete?.issuer })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}
