import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router'
import { FileText, MoreVertical, Eye, Trash2, Calendar, Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import type { Budget, BudgetStatus } from '@/lib/budget-api'
import { getExecutedItemsCount } from '@/lib/budget-api'
import { downloadBudgetPdf } from '@/lib/pdf-api'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { Can } from '@/components/auth'

interface BudgetCardProps {
  budget: Budget
  patientId: string
  onDelete: (budget: Budget) => void
}

const STATUS_STYLES: Record<BudgetStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 border-gray-200',
  APPROVED: 'bg-blue-100 text-blue-700 border-blue-200',
  PARTIAL: 'bg-amber-100 text-amber-700 border-amber-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function BudgetCard({ budget, patientId, onDelete }: BudgetCardProps) {
  const { t, i18n } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { executed, total: totalItems } = getExecutedItemsCount(budget)

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const canDelete = can(Permission.BUDGETS_DELETE)

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true)
    try {
      await downloadBudgetPdf(budget.id)
    } catch (error) {
      console.error('Failed to download budget PDF', error)
    } finally {
      setIsDownloadingPdf(false)
      setMenuOpen(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900 truncate">
                  {formatCurrency(Number(budget.totalAmount), currency)}
                </h3>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[budget.status]}`}
                >
                  {t(`budgets.status.${budget.status}`)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('budgets.createdOn', { date: formatShortDate(budget.createdAt, i18n.language) })}
              </p>
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-10 w-48 rounded-md border border-gray-200 bg-white shadow-lg">
                <Can permission={Permission.BUDGETS_VIEW}>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {t('budgets.downloadPdf')}
                  </button>
                </Can>
                <Link
                  to={`/patients/${patientId}/budgets/${budget.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Eye className="h-4 w-4" />
                  {t('budgets.viewDetail')}
                </Link>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onDelete(budget)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('budgets.deleteBudget')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600 flex-wrap gap-2">
          <span>
            {t('budgets.itemsProgress', { executed, total: totalItems })}
          </span>
          {budget.validUntil && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {t('budgets.validUntil')}:{' '}
              {formatShortDate(budget.validUntil, i18n.language)}
            </span>
          )}
        </div>

        {totalItems > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(executed / totalItems) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
