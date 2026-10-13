import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  MEDICAL_CRITICALITIES,
  MEDICAL_HISTORY_FIELDS,
  Permission,
  type MedicalCriticality,
  type MedicalHistory,
  type MedicalHistoryEntry,
  type MedicalHistoryField,
} from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { getMedicalHistory, updateMedicalHistory } from '@/lib/medical-history-api'
import {
  MEDICAL_ENTRY_MAX_LENGTH,
  MEDICAL_SECTION_MAX_ENTRIES,
  validateMedicalEntries,
  type MedicalEntriesValidation,
} from '@/lib/medical-history-validation'

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

interface MedicalHistorySectionProps {
  field: MedicalHistoryField
  patientId: string
  entries: MedicalHistoryEntry[]
  canUpdate: boolean
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSaved: (data: MedicalHistory) => void
}

function MedicalHistorySection({
  field,
  patientId,
  entries,
  canUpdate,
  editing,
  onEdit,
  onCancel,
  onSaved,
}: MedicalHistorySectionProps) {
  const { t } = useTranslation()
  const label = t(`patients.medicalHistoryBlock.sections.${field}`)

  return (
    <div data-testid={`medical-history-section-${field}`} data-field={field}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h4 className="text-sm font-medium text-gray-500">{label}</h4>
        {canUpdate && !editing && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${t('patients.medicalHistoryBlock.edit')}: ${label}`}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {entries.length === 0
              ? t('patients.medicalHistoryBlock.add')
              : t('patients.medicalHistoryBlock.edit')}
          </button>
        )}
      </div>
      {editing ? (
        <SectionEditor
          field={field}
          patientId={patientId}
          initial={entries}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      ) : (
        entries.length > 0 && (
          <ul className="space-y-1">
            {entries.map((entry, index) => (
              <MedicalEntryRow key={index} entry={entry} />
            ))}
          </ul>
        )
      )}
    </div>
  )
}

// Only critical entries get the strong treatment; routine rows stay plain so a
// single critical entry among many reads as the one that matters.
function MedicalEntryRow({ entry }: { entry: MedicalHistoryEntry }) {
  const { t } = useTranslation()
  if (entry.criticality === 'critical') {
    return (
      <li
        data-criticality="critical"
        className="flex items-center gap-2 rounded-lg border-2 border-red-600 bg-red-50 px-3 py-2 text-sm font-bold text-red-900"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
        <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold uppercase text-white">
          {t('patients.medicalHistoryBlock.criticalMarker')}
        </span>
        <span className="break-words min-w-0">{entry.text}</span>
      </li>
    )
  }
  return (
    <li data-criticality={entry.criticality} className="px-3 text-sm text-gray-700 break-words">
      {entry.text}
    </li>
  )
}

interface SectionEditorProps {
  field: MedicalHistoryField
  patientId: string
  initial: MedicalHistoryEntry[]
  onCancel: () => void
  onSaved: (data: MedicalHistory) => void
}

function SectionEditor({ field, patientId, initial, onCancel, onSaved }: SectionEditorProps) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<MedicalHistoryEntry[]>(initial)
  const [validation, setValidation] = useState<MedicalEntriesValidation | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const updateDraft = (index: number, patch: Partial<MedicalHistoryEntry>) => {
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  const handleSave = async () => {
    const result = validateMedicalEntries(drafts)
    setValidation(result)
    if (!result.valid) return

    setSaving(true)
    setSaveFailed(false)
    try {
      // Only this section is sent; the API leaves the other four untouched.
      const data = await updateMedicalHistory(patientId, { [field]: result.entries })
      onSaved(data)
    } catch {
      setSaveFailed(true)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {drafts.map((draft, index) => {
        const error = validation?.errors[index]
        return (
          <div key={index}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft.text}
                onChange={(e) => updateDraft(index, { text: e.target.value })}
                aria-label={t('patients.medicalHistoryBlock.entryLabel', { number: index + 1 })}
                aria-invalid={error ? true : undefined}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <select
                value={draft.criticality}
                onChange={(e) =>
                  updateDraft(index, { criticality: e.target.value as MedicalCriticality })
                }
                aria-label={t('patients.medicalHistoryBlock.criticalityLabel')}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {MEDICAL_CRITICALITIES.map((criticality) => (
                  <option key={criticality} value={criticality}>
                    {t(`patients.medicalHistoryBlock.criticality.${criticality}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                {t('patients.medicalHistoryBlock.remove')}
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {t(`patients.medicalHistoryBlock.errors.${error}`, {
                  max: MEDICAL_ENTRY_MAX_LENGTH,
                })}
              </p>
            )}
          </div>
        )
      })}
      {validation?.section && (
        <p role="alert" className="text-xs text-red-600">
          {t(`patients.medicalHistoryBlock.errors.${validation.section}`, {
            max: MEDICAL_SECTION_MAX_ENTRIES,
          })}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="text-xs text-red-600">
          {t('patients.medicalHistoryBlock.errors.saveFailed')}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setDrafts((current) => [...current, { text: '', criticality: 'normal' }])}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          {t('patients.medicalHistoryBlock.addEntry')}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-600 hover:text-gray-800"
        >
          {t('patients.medicalHistoryBlock.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {t('patients.medicalHistoryBlock.save')}
        </button>
      </div>
    </div>
  )
}
