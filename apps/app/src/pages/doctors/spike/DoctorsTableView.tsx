/**
 * SPIKE POC for #213 — throwaway code, not for production.
 * Dense sortable table alternative to the DoctorCard grid. Reached via
 * DoctorsPage `?view=table`. See docs/spikes/213-patient-doctor-list-views.md.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { Doctor } from '@/lib/doctor-api'

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

interface DoctorsTableViewProps {
  doctors: Doctor[]
  onEdit: (doctor: Doctor) => void
  onDelete: (doctor: Doctor) => void
  onRestore?: (doctor: Doctor) => void
}

export function DoctorsTableView({ doctors, onEdit, onDelete, onRestore }: DoctorsTableViewProps) {
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

  const sortedDoctors = useMemo(() => {
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
        aria-sort={sortKey === column ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
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
            {sortableHeader('name', t('doctors.list.name'))}
            {sortableHeader('specialty', t('doctors.form.specialty'))}
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              {t('doctors.list.contact')}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              {t('doctors.list.workingDays')}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('common.status')}
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('common.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedDoctors.map((doctor) => {
            const initials = `${doctor.firstName[0]}${doctor.lastName[0]}`.toUpperCase()
            return (
              <tr key={doctor.id} className={doctor.isActive ? 'hover:bg-gray-50' : 'bg-orange-50/40 hover:bg-orange-50'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {doctor.avatar ? (
                      <img src={doctor.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                        <span className="text-xs font-semibold text-white">{initials}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        Dr. {doctor.firstName} {doctor.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate md:hidden">{doctor.phone || doctor.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{doctor.specialty || '—'}</td>
                <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                  <div className="truncate max-w-[220px]">{doctor.phone || '—'}</div>
                  <div className="truncate max-w-[220px] text-xs text-gray-400">{doctor.email || ''}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
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
                <td className="px-4 py-3">
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
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/doctors/${doctor.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('doctors.list.viewRecord')}
                    </Link>
                    {!doctor.isActive && onRestore ? (
                      <button
                        onClick={() => onRestore(doctor)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 rounded-lg transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('common.restore')}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => onEdit(doctor)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => onDelete(doctor)}
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

export default DoctorsTableView
