import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Loader2, AlertCircle, DollarSign, Undo2, ArrowRightLeft, RotateCcw } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import {
  getPatientPaymentMovements,
  type PaymentMovement,
  type PaymentMovementType,
} from '@/lib/payment-api'
import { formatActor } from '@/lib/format-actor'

// ============================================================================
// Main Component
// ============================================================================

interface PaymentMovementsSectionProps {
  patientId: string
  // Bumped by the parent whenever a payment is created, reversed, or an
  // appointment cancellation/restore converts one — every action that can
  // add a row to this ledger.
  refreshKey?: number
}

const TYPE_ICON: Record<PaymentMovementType, typeof DollarSign> = {
  RECEIVED: DollarSign,
  REVERSED: Undo2,
  CONVERTED_TO_ADVANCE: ArrowRightLeft,
  RESTORED_TO_APPOINTMENT: RotateCcw,
}

const TYPE_COLOR: Record<PaymentMovementType, string> = {
  RECEIVED: 'bg-green-100 text-green-600',
  REVERSED: 'bg-red-100 text-red-600',
  CONVERTED_TO_ADVANCE: 'bg-amber-100 text-amber-600',
  RESTORED_TO_APPOINTMENT: 'bg-blue-100 text-blue-600',
}

// The <input type="date"> value is a bare YYYY-MM-DD. `new Date(dateStr)`
// parses that as UTC midnight, which is the wrong calendar day in the local
// zone west of UTC (e.g. Uruguay, UTC-3) — building the Date from its y/m/d
// parts instead pins it to local midnight, so the ISO instant sent to the
// API reflects the clinic user's actual local day.
function startOfLocalDayISO(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

function endOfLocalDayISO(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

export function PaymentMovementsSection({ patientId, refreshKey = 0 }: PaymentMovementsSectionProps) {
  const { t, i18n } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [movements, setMovements] = useState<PaymentMovement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fmtCurrency = useCallback((amount: number) => formatCurrency(amount, currency), [currency])
  const fmtDate = useCallback(
    (value: string) =>
      new Date(value).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language]
  )

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getPatientPaymentMovements(patientId, {
        from: from ? startOfLocalDayISO(from) : undefined,
        to: to ? endOfLocalDayISO(to) : undefined,
      })
      setMovements(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading movements')
    } finally {
      setIsLoading(false)
    }
  }, [patientId, from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshKey])

  // The origin appointment's date is only shown for the two conversion
  // types — a RECEIVED/REVERSED row of a kind=APPOINTMENT payment carries an
  // appointmentId too, but that appointment is not what happened here.
  const originAppointmentText = (movement: PaymentMovement) => {
    if (!movement.appointmentDate) return null
    if (movement.type === 'CONVERTED_TO_ADVANCE') {
      return t('payments.movements.originAppointmentCancelled', { date: fmtDate(movement.appointmentDate) })
    }
    if (movement.type === 'RESTORED_TO_APPOINTMENT') {
      return t('payments.movements.originAppointment', { date: fmtDate(movement.appointmentDate) })
    }
    return null
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
      {/* Header */}
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('patients.tabs.movements')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('payments.movements.subtitle')}</p>

      {/* Date range filter */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder={t('payments.movements.dateFrom')}
          aria-label={t('payments.movements.dateFrom')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-400">—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t('payments.movements.dateTo')}
          aria-label={t('payments.movements.dateTo')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : movements.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <History className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">{t('payments.movements.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {movements.map((movement, index) => {
            const Icon = TYPE_ICON[movement.type]
            const actorText = formatActor(movement.actor, t)
            const originText = originAppointmentText(movement)

            return (
              <div
                key={`${movement.paymentId}-${movement.type}-${movement.at}-${index}`}
                className="flex items-center gap-3 p-3 border border-gray-100 rounded-lg"
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${TYPE_COLOR[movement.type]}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {t(`payments.movements.types.${movement.type}`)} · {fmtCurrency(movement.amount)}
                  </p>
                  <p className="text-xs text-gray-500">{fmtDate(movement.at)}</p>
                  {originText && <p className="text-xs text-gray-400">{originText}</p>}
                  {movement.reason && <p className="text-xs text-gray-400 truncate">{movement.reason}</p>}
                  {actorText && <p className="text-xs text-gray-400">{actorText}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
