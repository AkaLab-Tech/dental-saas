import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ClipboardList, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import { downloadBudgetPdf } from '@/lib/pdf-api'
import { formatCurrency } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'
import { useBudgetsStore } from '@/stores/budgets.store'
import { Can } from '@/components/auth'

interface PatientBudgetPdfButtonProps {
  patientId: string
  onError: (message: string) => void
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Header export for the patient's budgets. Reads the list that BudgetsSection
 * already fetches into the shared store; it never fetches on its own.
 */
export function PatientBudgetPdfButton({ patientId, onError }: PatientBudgetPdfButtonProps) {
  const { t, i18n } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  const budgets = useBudgetsStore((s) => s.budgets)
  const currentPatientId = useBudgetsStore((s) => s.currentPatientId)
  const loading = useBudgetsStore((s) => s.loading)
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  // The store is global: until the fetch for this patient lands, `budgets`
  // may still hold the previous patient's list.
  // A failed fetch leaves that stale list in place with loading=false, so the
  // store bookkeeping alone is not enough: filter on each budget's owner.
  const listIsForThisPatient = currentPatientId === patientId && !loading
  const ownBudgets = budgets.filter((b) => b.patientId === patientId)
  if (!listIsForThisPatient || ownBudgets.length === 0) return null

  const download = async (budgetId: string) => {
    setMenuOpen(false)
    setDownloading(true)
    try {
      await downloadBudgetPdf(budgetId)
    } catch (e) {
      console.error(e)
      onError(t('budgets.exportPdfError'))
    } finally {
      setDownloading(false)
    }
  }

  const hasChoice = ownBudgets.length > 1
  const buttonClass =
    'inline-flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50'

  return (
    <Can permission={Permission.BUDGETS_VIEW}>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => (hasChoice ? setMenuOpen((v) => !v) : void download(ownBudgets[0].id))}
          disabled={downloading}
          aria-haspopup={hasChoice ? 'menu' : undefined}
          aria-expanded={hasChoice ? menuOpen : undefined}
          className={buttonClass}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ClipboardList className="h-4 w-4" />
          )}
          {t('budgets.exportPdf')}
          {hasChoice && <ChevronDown className="h-4 w-4" />}
        </button>
        {hasChoice && menuOpen && (
          <div
            role="menu"
            aria-label={t('budgets.exportPdfChoose')}
            className="absolute end-0 top-full mt-1 z-10 w-72 rounded-md border border-gray-200 bg-white shadow-lg"
          >
            <p className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
              {t('budgets.exportPdfChoose')}
            </p>
            {ownBudgets.map((budget) => (
              <button
                key={budget.id}
                type="button"
                role="menuitem"
                onClick={() => void download(budget.id)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="font-semibold text-gray-900">
                  {formatCurrency(Number(budget.totalAmount), currency)}
                </span>
                <span className="text-xs text-gray-500">
                  {t('budgets.createdOn', { date: formatShortDate(budget.createdAt, i18n.language) })}
                  {' · '}
                  {t(`budgets.status.${budget.status}`)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Can>
  )
}
