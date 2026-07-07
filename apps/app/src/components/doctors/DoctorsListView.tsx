import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { Doctor } from '@/lib/doctor-api'
import { SortableHeader, useSortState } from '@/components/list/SortableHeader'

const DAYS_MAP: Record<string, string> = {
  MON: 'L',
  TUE: 'M',
  WED: 'X',
  THU: 'J',
  FRI: 'V',
  SAT: 'S',
  SUN: 'D',
}
const DAYS_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

type SortKey = 'name' | 'specialty'
type SortDir = 'asc' | 'desc'

interface DoctorsListViewProps {
  doctors: Doctor[]
  onEdit: (doctor: Doctor) => void
  onDelete: (doctor: Doctor) => void
  onRestore?: (doctor: Doctor) => void
}

function useSortedDoctors(doctors: Doctor[], sortKey: SortKey, sortDir: SortDir) {
  return useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...doctors].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
        case 'specialty':
          return dir * (a.specialty || '').localeCompare(b.specialty || '')
        default:
          return 0
      }
    })
  }, [doctors, sortKey, sortDir])
}

function ActionButtons({
  doctor,
  onEdit,
  onDelete,
  onRestore,
  compact,
}: {
  doctor: Doctor
  onEdit: (doctor: Doctor) => void
  onDelete: (doctor: Doctor) => void
  onRestore?: (doctor: Doctor) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const size = compact ? 'px-2.5 py-1.5 text-xs' : 'px-2 py-1 text-xs'
  return (
    <>
      <Link
        to={`/doctors/${doctor.id}`}
        className={`inline-flex items-center gap-1 ${size} font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t('doctors.list.viewRecord')}
      </Link>
      {!doctor.isActive && onRestore ? (
        <button
          onClick={() => onRestore(doctor)}
          className={`inline-flex items-center gap-1 ${size} font-medium text-green-700 hover:bg-green-100 rounded-lg transition-colors`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('common.restore')}
        </button>
      ) : (
        <>
          <button
            onClick={() => onEdit(doctor)}
            className={`inline-flex items-center gap-1 ${size} font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors`}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('common.edit')}
          </button>
          <button
            onClick={() => onDelete(doctor)}
            className={`inline-flex items-center gap-1 ${size} font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('common.delete')}
          </button>
        </>
      )}
    </>
  )
}

export function DoctorsListView({ doctors, onEdit, onDelete, onRestore }: DoctorsListViewProps) {
  const { t } = useTranslation()
  const { sortKey, sortDir, toggleSort } = useSortState<SortKey>('name')
  const sortedDoctors = useSortedDoctors(doctors, sortKey, sortDir)

  const columnLabels: Record<SortKey, string> = {
    name: t('doctors.list.name'),
    specialty: t('doctors.form.specialty'),
  }

  return (
    <>
      {/* Desktop: dense table (lg and up) */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {(['name', 'specialty'] as SortKey[]).map((column) => (
                <SortableHeader
                  key={column}
                  label={columnLabels[column]}
                  active={sortKey === column}
                  dir={sortDir}
                  onClick={() => toggleSort(column)}
                />
              ))}
              <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                {t('doctors.list.contact')}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                {t('doctors.list.workingDays')}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                {t('common.status')}
              </th>
              <th className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedDoctors.map((doctor) => {
              const initials = `${doctor.firstName[0]}${doctor.lastName[0]}`.toUpperCase()
              return (
                <tr key={doctor.id} className={doctor.isActive ? 'hover:bg-gray-50' : 'bg-orange-50/40 hover:bg-orange-50'}>
                  <td className="px-4 py-3 text-start">
                    <div className="flex items-center gap-3">
                      {doctor.avatar ? (
                        <img src={doctor.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                          <span className="text-xs font-semibold text-white">{initials}</span>
                        </div>
                      )}
                      <p className="font-medium text-gray-900">
                        Dr. {doctor.firstName} {doctor.lastName}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-start text-gray-600 whitespace-nowrap">{doctor.specialty || '—'}</td>
                  <td className="px-4 py-3 text-start text-gray-600">
                    <div className="truncate max-w-[220px]">{doctor.phone || '—'}</div>
                    <div className="truncate max-w-[220px] text-xs text-gray-400">{doctor.email || ''}</div>
                  </td>
                  <td className="px-4 py-3 text-start">
                    <div className="flex gap-1">
                      {DAYS_ORDER.map((day) => (
                        <span
                          key={day}
                          className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-medium ${
                            doctor.workingDays?.includes(day) ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {DAYS_MAP[day]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-start">
                    {doctor.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {t('common.active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                        {t('common.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      <ActionButtons doctor={doctor} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: compact reflowed list rows (below lg) */}
      <div className="lg:hidden space-y-3">
        {sortedDoctors.map((doctor) => {
          const initials = `${doctor.firstName[0]}${doctor.lastName[0]}`.toUpperCase()
          return (
            <div
              key={doctor.id}
              className={`bg-white rounded-lg border shadow-sm p-4 ${
                doctor.isActive ? 'border-gray-200' : 'border-orange-200 bg-orange-50/30'
              }`}
            >
              <div className="flex items-start gap-3">
                {doctor.avatar ? (
                  <img src={doctor.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                    <span className="text-xs font-semibold text-white">{initials}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 truncate">
                      Dr. {doctor.firstName} {doctor.lastName}
                    </p>
                    {!doctor.isActive && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                        {t('common.inactive')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{doctor.specialty || ''}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{doctor.phone || doctor.email || '—'}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-gray-100">
                <ActionButtons doctor={doctor} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} compact />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default DoctorsListView
