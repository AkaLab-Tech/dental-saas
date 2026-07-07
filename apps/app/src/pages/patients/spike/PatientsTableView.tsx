/**
 * SPIKE POC for #213 — throwaway code, not for production.
 * Dense sortable table alternative to the PatientCard grid. Reached via
 * PatientsPage `?view=table`. See docs/spikes/213-patient-doctor-list-views.md.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { Patient } from '@/lib/patient-api'
import { calculateAge, getPatientInitials } from '@/lib/patient-api'

const GENDER_LABEL_KEYS: Record<string, string> = {
  male: 'patients.form.male',
  female: 'patients.form.female',
  other: 'patients.form.other',
  prefer_not_to_say: 'patients.form.preferNotToSay',
}

type SortKey = 'name' | 'gender' | 'age' | 'dob'
type SortDir = 'asc' | 'desc'

interface PatientsTableViewProps {
  patients: Patient[]
  onEdit: (patient: Patient) => void
  onDelete: (patient: Patient) => void
  onRestore?: (patient: Patient) => void
}

export function PatientsTableView({ patients, onEdit, onDelete, onRestore }: PatientsTableViewProps) {
  const { t } = useTranslation()
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedPatients = useMemo(() => {
    const withAge = patients.map((patient) => ({ patient, age: calculateAge(patient.dob) }))
    const dir = sortDir === 'asc' ? 1 : -1
    withAge.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * `${a.patient.firstName} ${a.patient.lastName}`.localeCompare(
            `${b.patient.firstName} ${b.patient.lastName}`
          )
        case 'gender':
          return dir * (a.patient.gender || '').localeCompare(b.patient.gender || '')
        case 'age':
          return dir * ((a.age ?? -1) - (b.age ?? -1))
        case 'dob':
          return dir * (a.patient.dob || '').localeCompare(b.patient.dob || '')
        default:
          return 0
      }
    })
    return withAge.map((row) => row.patient)
  }, [patients, sortKey, sortDir])

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (column !== sortKey) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-300" />
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5 text-gray-600" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-gray-600" />
    )
  }

  const sortableHeader = (column: SortKey, label: string) => (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="inline-flex items-center gap-1 hover:text-gray-700"
        aria-sort={
          sortKey === column ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
        }
      >
        {label}
        <SortIcon column={column} />
      </button>
    </th>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {sortableHeader('name', t('patients.list.name'))}
            {sortableHeader('gender', t('patients.list.genderAge'))}
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              {t('patients.list.contact')}
            </th>
            {sortableHeader('dob', t('patients.form.dob'))}
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('common.status')}
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('common.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedPatients.map((patient) => {
            const age = calculateAge(patient.dob)
            const genderLabel = patient.gender ? t(GENDER_LABEL_KEYS[patient.gender] || patient.gender) : null
            return (
              <tr key={patient.id} className={patient.isActive ? 'hover:bg-gray-50' : 'bg-orange-50/40 hover:bg-orange-50'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                      <span className="text-xs font-semibold text-white">{getPatientInitials(patient)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {patient.firstName} {patient.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate md:hidden">{patient.phone || patient.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {[genderLabel, age !== null ? `${age} ${t('patients.years')}` : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                  <div className="truncate max-w-[220px]">{patient.phone || '—'}</div>
                  <div className="truncate max-w-[220px] text-xs text-gray-400">{patient.email || ''}</div>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {patient.dob ? new Date(patient.dob).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                </td>
                <td className="px-4 py-3">
                  {patient.isActive ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {t('common.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                      {t('common.inactive')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/patients/${patient.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('patients.list.viewRecord')}
                    </Link>
                    {!patient.isActive && onRestore ? (
                      <button
                        onClick={() => onRestore(patient)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 rounded-lg transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('common.restore')}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => onEdit(patient)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => onDelete(patient)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('common.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PatientsTableView
