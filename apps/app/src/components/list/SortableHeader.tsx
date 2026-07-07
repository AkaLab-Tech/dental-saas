import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

export type SortDir = 'asc' | 'desc'

/** Shared sort-state hook for hybrid list/table views (patients, doctors, …). */
export function useSortState<K extends string>(initialKey: K) {
  const [sortKey, setSortKey] = useState<K>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (key: K) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return { sortKey, sortDir, toggleSort }
}

export function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-300" />
  return dir === 'asc' ? (
    <ArrowUp className="h-3.5 w-3.5 text-gray-600" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-gray-600" />
  )
}

/** `<th>` with a sortable button + `aria-sort` wiring, for dense desktop tables. */
export function SortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <th
      className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-gray-700"
      >
        {label}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  )
}
