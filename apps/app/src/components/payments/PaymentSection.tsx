import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Loader2, DollarSign, AlertCircle, PanelLeftClose } from 'lucide-react'
import { Permission } from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import {
  getPatientBalance,
  getPatientPayments,
  createPayment,
  deletePayment,
  type Payment,
  type PatientBalance,
  type CreatePaymentData,
} from '@/lib/payment-api'
import { PaymentFormModal } from './PaymentFormModal'

// ============================================================================
// Main Component
// ============================================================================

interface PaymentSectionProps {
  patientId: string
  onCollapse?: () => void
  // Bumped by the parent when an external action (e.g. saving an appointment
  // with isPaid=true) may have created or recalculated payments via FIFO.
  refreshKey?: number
  // Called after this section creates or deletes a payment, so the parent can
  // refresh sibling sections (appointments, labworks) whose isPaid may change.
  onPaymentsChange?: () => void
}

export function PaymentSection({
  patientId,
  onCollapse,
  refreshKey = 0,
  onPaymentsChange,
}: PaymentSectionProps) {
  const { t, i18n } = useTranslation()
  const { can } = usePermissions()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [balance, setBalance] = useState<PatientBalance | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fmtCurrency = useCallback(
    (amount: number) => formatCurrency(amount, currency),
    [currency]
  )

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const [balanceData, paymentsData] = await Promise.all([
        getPatientBalance(patientId),
        getPatientPayments(patientId, { limit: 50, kind: 'ADVANCE' }),
      ])
      setBalance(balanceData)
      setPayments(paymentsData.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading payments')
    } finally {
      setIsLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshKey])

  const handleCreatePayment = async (data: CreatePaymentData) => {
    setIsSaving(true)
    try {
      await createPayment(patientId, data)
      setIsFormOpen(false)
      await fetchData()
      onPaymentsChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creating payment')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm(t('payments.deleteConfirm'))) return

    setDeletingId(paymentId)
    try {
      await deletePayment(patientId, paymentId)
      await fetchData()
      onPaymentsChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error deleting payment')
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">{t('payments.title')}</h2>
        <div className="flex items-center gap-1.5">
          {can(Permission.PAYMENTS_CREATE) && balance && (
            <button
              onClick={() => setIsFormOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t('payments.newPayment')}
            </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="hidden lg:inline-flex p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('patients.collapseSidebar')}
            >
              <PanelLeftClose className="h-4 w-4 rtl:scale-x-[-1]" />
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">{t('payments.subtitle')}</p>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Balance Summary */}
      {balance && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-center">
          <div className="bg-gray-50 px-2 py-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">{t('payments.totalDebt')}</p>
            <p className="text-base font-bold text-gray-900 leading-tight">{fmtCurrency(balance.totalDebt)}</p>
          </div>
          <div className="bg-gray-50 px-2 py-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">{t('payments.totalPaid')}</p>
            <p className="text-base font-bold text-green-600 leading-tight">{fmtCurrency(balance.totalPaid)}</p>
          </div>
          <div className="bg-gray-50 px-2 py-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">{t('payments.outstanding')}</p>
            <p className={`text-base font-bold leading-tight ${balance.outstanding > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {fmtCurrency(balance.outstanding)}
            </p>
          </div>
          <div className="bg-green-50 px-2 py-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">{t('payments.credit')}</p>
            <p className="text-base font-bold leading-tight text-green-600">
              {fmtCurrency(balance.credit)}
            </p>
          </div>
        </div>
      )}

      {/* Payments List */}
      {payments.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <DollarSign className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">{t('payments.noPayments')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 shrink-0">
                  <DollarSign className="h-4 w-4 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{fmtCurrency(payment.amount)}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(payment.date).toLocaleDateString(i18n.language, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  {payment.note && (
                    <p className="text-xs text-gray-400 truncate">{payment.note}</p>
                  )}
                </div>
              </div>
              {can(Permission.PAYMENTS_DELETE) && (
                <button
                  onClick={() => handleDeletePayment(payment.id)}
                  disabled={deletingId === payment.id}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                  title={t('common.delete')}
                >
                  {deletingId === payment.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Payment Form Modal */}
      {balance && (
        <PaymentFormModal
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          onSubmit={handleCreatePayment}
          formatCurrency={fmtCurrency}
          isLoading={isSaving}
        />
      )}
    </div>
  )
}
