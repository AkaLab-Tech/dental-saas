import { useTranslation } from 'react-i18next'
import type { BudgetVisit } from '@/lib/budget-api'
import { formatCurrency } from '@/lib/format'

interface BudgetPaymentsTableProps {
  visits: BudgetVisit[]
  currency: string
}

export function BudgetPaymentsTable({ visits, currency }: BudgetPaymentsTableProps) {
  const { t, i18n } = useTranslation()

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('budgets.paymentsTitle')}</h2>
      {visits.length === 0 ? (
        <p className="text-sm text-gray-500">{t('budgets.paymentsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-gray-500 border-b border-gray-100">
                <th className="py-2 pe-4 text-start font-medium">{t('budgets.paymentsDate')}</th>
                <th className="py-2 pe-4 text-start font-medium">{t('budgets.paymentsWhat')}</th>
                <th className="py-2 pe-4 text-start font-medium">{t('budgets.paymentsNotes')}</th>
                <th className="py-2 pe-4 text-end font-medium">{t('budgets.paymentsCharged')}</th>
                <th className="py-2 text-end font-medium">{t('budgets.paymentsCovered')}</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => (
                <tr key={visit.appointmentId} className="border-b border-gray-50 align-top">
                  <td className="py-2 pe-4 whitespace-nowrap">
                    {new Date(visit.date).toLocaleDateString(i18n.language)}
                  </td>
                  <td className="py-2 pe-4">
                    {visit.lines.map((line) => (
                      <div key={line.budgetItemId}>{line.description}</div>
                    ))}
                  </td>
                  <td className="py-2 pe-4 text-gray-600">
                    {visit.lines.map((line) => (
                      <div key={line.budgetItemId}>{line.notes ?? ''}</div>
                    ))}
                  </td>
                  <td className="py-2 pe-4 text-end">{formatCurrency(visit.charged, currency)}</td>
                  <td className="py-2 text-end">{formatCurrency(visit.covered, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
