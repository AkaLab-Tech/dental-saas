import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { PatientsListView } from './PatientsListView'
import type { Patient } from '@/lib/patient-api'

// Task #655, call sites 1 and 2. The zone and the clock are pinned: at
// 2026-05-12T01:00Z it is 11 May 22:00 in Montevideo, the day before the
// birthday, so the age is 41. The fixture's dob is the sole source of 41/42.
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const patient: Patient = {
  id: 'p-age',
  tenantId: 'tenant1',
  firstName: 'Ana',
  lastName: 'Alfa',
  email: 'a@example.com',
  phone: '+1000000000',
  dob: '1984-05-12T00:00:00.000Z',
  gender: 'female',
  coverageType: 'PARTICULAR',
  convenioName: null,
  address: null,
  notes: null,
  teeth: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('PatientsListView age (#655)', () => {
  it('shows 41 on both the desktop row and the mobile row, and never 42', () => {
    vi.stubEnv('TZ', 'America/Montevideo')
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Montevideo')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-12T01:00:00Z'))

    render(
      <MemoryRouter>
        <PatientsListView patients={[patient]} onEdit={vi.fn()} onDelete={vi.fn()} onRestore={vi.fn()} />
      </MemoryRouter>
    )

    // jsdom applies no lg: breakpoints, so both surfaces are in the DOM.
    expect(screen.getAllByText(/41 años/)).toHaveLength(2)
    expect(screen.queryAllByText(/42/)).toHaveLength(0)
  })
})
