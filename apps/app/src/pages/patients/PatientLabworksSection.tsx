import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Labwork } from '@/lib/labwork-api'
import { getLabworks, getLabworkStatusBadge, formatLabworkDate } from '@/lib/labwork-api'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'

interface PatientLabworksSectionProps {
  patientId: string
  refreshKey?: number
}

const BADGE_STYLES: Record<'default' | 'success' | 'warning' | 'destructive', string> = {
  default: 'bg-gray-100 text-gray-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  destructive: 'bg-red-100 text-red-800',
}

// ============================================================================
// PatientLabworkRow
// ============================================================================

function PatientLabworkRow({ labwork, currency }: { labwork: Labwork; currency: string }) {
  const statusBadge = getLabworkStatusBadge(labwork)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
            <FlaskConical className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{labwork.lab}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{formatLabworkDate(labwork.date)}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BADGE_STYLES[statusBadge.variant]}`}
          >
            {statusBadge.label}
          </span>
          <span className="text-sm font-medium text-gray-900">
            {formatCurrency(labwork.price, currency)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Section Component
// ============================================================================

export function PatientLabworksSection({ patientId, refreshKey = 0 }: PatientLabworksSectionProps) {
  const { t } = useTranslation()
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [labworks, setLabworks] = useState<Labwork[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPatientLabworks = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await getLabworks({ patientId, limit: 100 })
      setLabworks(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('patients.labworksSection.error'))
    } finally {
      setIsLoading(false)
    }
  }, [patientId, t])

  useEffect(() => {
    fetchPatientLabworks()
  }, [fetchPatientLabworks, refreshKey])

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="h-5 w-5 text-purple-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          {t('patients.labworksSection.title')}
        </h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {t('common.loading')}
        </div>
      ) : error ? (
        <div role="alert" className="text-sm text-red-600 py-4">
          {error}
        </div>
      ) : labworks.length === 0 ? (
        <div className="py-10 text-center">
          <FlaskConical className="h-10 w-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">{t('patients.labworksSection.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {labworks.map((labwork) => (
            <PatientLabworkRow key={labwork.id} labwork={labwork} currency={currency} />
          ))}
        </div>
      )}
    </div>
  )
}
