import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, Wallet } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { getDebtors, type Debtor } from '@/lib/payment-api'

export function PatientDebtsPage() {
  const { t } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDebtors()
      .then(setDebtors)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error loading debtors'))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('payments.debtors.title')}</h1>
        <p className="text-gray-600 mt-1">{t('payments.debtors.subtitle')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      ) : debtors.length === 0 ? (
        <div className="text-center py-12">
          <Wallet className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-gray-500">{t('payments.debtors.empty')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">{t('payments.debtors.patient')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('payments.totalDebt')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('payments.totalPaid')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('payments.outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {debtors.map((debtor) => (
                <tr key={debtor.patientId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/patients/${debtor.patientId}`} className="text-blue-600 hover:text-blue-800 font-medium">
                      {debtor.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(debtor.totalDebt, currency)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{formatCurrency(debtor.totalPaid, currency)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">
                    {formatCurrency(debtor.outstanding, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PatientDebtsPage
