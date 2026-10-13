import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MEDICAL_HISTORY_FIELDS,
  Permission,
  type MedicalHistory,
  type MedicalHistoryField,
} from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { getMedicalHistory } from '@/lib/medical-history-api'
import { MedicalHistorySection } from './medical-history-sections'

interface MedicalHistoryBlockProps {
  patientId: string
}

// The history is stored with the id it belongs to, so a render can never show
// one patient's entries under another patient's id.
interface LoadedHistory {
  patientId: string
  data: MedicalHistory
}

function hasAnyEntry(history: MedicalHistory): boolean {
  return MEDICAL_HISTORY_FIELDS.some((field) => history[field].length > 0)
}

/**
 * Medical history in the patient record's profile block. Renders nothing at all
 * unless the history is loaded and has at least one entry, for every role; it
 * never shows a heading, placeholder or affordance for an empty history.
 */
export function MedicalHistoryBlock({ patientId }: MedicalHistoryBlockProps) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canView = can(Permission.MEDICAL_HISTORY_VIEW)
  const canUpdate = can(Permission.MEDICAL_HISTORY_UPDATE)

  const [loaded, setLoaded] = useState<LoadedHistory | null>(null)
  const [editingField, setEditingField] = useState<MedicalHistoryField | null>(null)

  useEffect(() => {
    // Drop the previous patient's data before the new fetch can resolve.
    setLoaded(null)
    setEditingField(null)
    if (!canView) return

    let cancelled = false
    getMedicalHistory(patientId)
      .then((data) => {
        if (!cancelled) setLoaded({ patientId, data })
      })
      .catch(() => {
        // A failed read renders nothing rather than a misleading empty state.
      })
    return () => {
      cancelled = true
    }
  }, [patientId, canView])

  if (!canView || !loaded || loaded.patientId !== patientId) return null

  const history = loaded.data

  if (!hasAnyEntry(history)) return null

  const visibleFields = MEDICAL_HISTORY_FIELDS.filter(
    (field) => canUpdate || history[field].length > 0
  )

  const handleSaved = (data: MedicalHistory) => {
    setLoaded({ patientId, data })
    setEditingField(null)
  }

  return (
    <section data-testid="medical-history-block" className="mt-6 border-t border-gray-100 pt-4">
      <h3 className="text-base font-semibold text-gray-900 mb-3">{t('patients.medicalHistory')}</h3>
      <div className="space-y-4">
        {visibleFields.map((field) => (
          <MedicalHistorySection
            key={field}
            field={field}
            patientId={patientId}
            entries={history[field]}
            canUpdate={canUpdate}
            editing={editingField === field}
            onEdit={() => setEditingField(field)}
            onCancel={() => setEditingField(null)}
            onSaved={handleSaved}
          />
        ))}
      </div>
    </section>
  )
}
