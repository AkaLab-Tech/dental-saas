import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type { AccountStatement as AccountStatementData } from '@/lib/payment-api'

interface AccountStatementProps {
  statement: AccountStatementData
  formatCurrency: (amount: number) => string
}

// Renders the three account-statement numbers as separate, individually
// labelled figures. They are never summed into a single "total owed": a
// SCHEDULED costed appointment can legitimately count towards both
// appointmentsDebt and remainingBudgetProjection, so adding them together
// would double-count.
export function AccountStatement({ statement, formatCurrency }: AccountStatementProps) {
  const { t } = useTranslation()

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
