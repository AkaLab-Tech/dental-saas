import { useTranslation } from 'react-i18next'
import { Info, Lock } from 'lucide-react'
import type { AccountStatement as AccountStatementData } from '@/lib/payment-api'
import { formatShortDate } from '@/lib/format'

interface AccountStatementProps {
  statement: AccountStatementData
  formatCurrency: (amount: number) => string
  /**
   * Task #571: createdAt (ISO) per budget id, used only to NAME a held
   * reservation. Money never comes from here — a row's figure is the API's
   * own `remaining`, and the total is its own `advancesHeld`.
   */
  budgetCreatedAt?: Record<string, string>
}

// Renders the three account-statement numbers as separate, individually
// labelled figures. They are never summed into a single "total owed": a
// SCHEDULED costed appointment can legitimately count towards both
// appointmentsDebt and remainingBudgetProjection, so adding them together
// would double-count.
export function AccountStatement({
  statement,
  formatCurrency,
  budgetCreatedAt,
}: AccountStatementProps) {
  const { t, i18n } = useTranslation()

  // Task #571: the held total is the API's own figure (`advancesHeld`, the
  // `heldCents` already subtracted from advancesCredit); recomputing it from
  // the rows here is how the two would drift.
  const heldTotal = statement.advancesHeld
  const heldRows = (statement.reservedAdvances ?? []).filter((r) => r.open && r.remaining > 0)

  return (
    <div className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-amber-50 border border-amber-100 px-3 py-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">{t('payments.statement.appointmentsDebt')}</p>
          <p
            className={`text-base font-bold leading-tight ${
              statement.appointmentsDebt > 0 ? 'text-amber-600' : 'text-gray-900'
            }`}
          >
            {formatCurrency(statement.appointmentsDebt)}
          </p>
        </div>
        <div className="bg-green-50 border border-green-100 px-3 py-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">{t('payments.credit')}</p>
          <p className="text-base font-bold leading-tight text-green-600">
            {formatCurrency(statement.advancesCredit)}
          </p>
        </div>
      </div>

      {heldTotal !== undefined && heldRows.length > 0 && (
        <div
          data-testid="statement-held-advances"
          className="bg-blue-50 border border-blue-100 px-3 py-3 rounded-lg mt-2"
        >
          <div className="flex items-start gap-2">
            <Lock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs text-gray-500 mb-1">{t('payments.statement.heldAdvances')}</p>
              <p
                data-testid="statement-held-total"
                className="text-base font-bold leading-tight text-blue-700"
              >
                {formatCurrency(heldTotal)}
              </p>
              <ul className="mt-1 space-y-0.5">
                {heldRows.map((row) => {
                  const createdAt = budgetCreatedAt?.[row.budgetId]
                  return (
                    <li
                      key={row.budgetId}
                      data-testid="statement-held-budget-row"
                      className="text-xs text-gray-600"
                    >
                      {createdAt
                        ? t('payments.statement.heldForBudget', {
                            date: formatShortDate(createdAt, i18n.language),
                            amount: formatCurrency(row.remaining),
                          })
                        : t('payments.statement.heldForUnnamedBudget', {
                            amount: formatCurrency(row.remaining),
                          })}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 px-3 py-3 rounded-lg mt-2">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-1">{t('payments.statement.remainingBudget')}</p>
            <p className="text-base font-bold leading-tight text-gray-700">
              {formatCurrency(statement.remainingBudgetProjection)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {t('payments.statement.remainingBudgetDisclaimer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
