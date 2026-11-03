// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { PublicBudgetPage } from './PublicBudgetPage'
import * as api from '@/lib/api'

// Task #653. Zone pinned per test with vi.stubEnv('TZ', ...), never inherited.
const MONTEVIDEO = 'America/Montevideo'
const UTC = 'UTC'

// A calendar day is stored as UTC midnight of the day entered.
const CALENDAR_DAY = '2026-10-28T00:00:00.000Z'
// An instant on its OWN day, 22:30 on 20 Oct in Montevideo (UTC-3) = 01:30 on 21 Oct UTC, so
// 'Válido hasta' can only be satisfied by validUntil and 'Emitido el' only by createdAt.
const CREATED_AT_INSTANT = '2026-10-21T01:30:00.000Z'

vi.mock('react-router', () => ({
  useParams: () => ({ token: 'mock-token' }),
}))

vi.mock('@/lib/api', () => ({
  fetchPublicBudget: vi.fn(),
}))

function pinZone(zone: string) {
  vi.stubEnv('TZ', zone)
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
}

function mockBudgetData(): api.FetchPublicBudgetResult {
  return {
    ok: true,
    data: {
      id: 'b-1',
      tenant: {
        name: 'Clinica Test',
        currency: 'USD',
        language: 'es',
        email: null,
        phone: null,
        address: null,
        logo: null,
      },
      patient: { firstName: 'Juan', lastName: 'Perez' },
      status: 'APPROVED',
      createdAt: CREATED_AT_INSTANT,
      validUntil: CALENDAR_DAY,
      notes: null,
      totalAmount: '100',
      items: [],
    },
  }
}

describe('PublicBudgetPage validUntil calendar-day rendering (#653)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchPublicBudget).mockResolvedValue(mockBudgetData())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('renders the entered calendar day (28 de octubre de 2026) for a viewer in UTC', async () => {
    pinZone(UTC)
    render(<PublicBudgetPage />)

    await waitFor(() => {
      const label = screen.getByText('Válido hasta')
      expect(label.nextElementSibling).toHaveTextContent('28 de octubre de 2026')
    })
  })

  it('renders the entered calendar day (28 de octubre de 2026) for a viewer in Montevideo (UTC-3)', async () => {
    pinZone(MONTEVIDEO)
    render(<PublicBudgetPage />)

    await waitFor(() => {
      const label = screen.getByText('Válido hasta')
      expect(label.nextElementSibling).toHaveTextContent('28 de octubre de 2026')
    })
  })

  // Instant control: createdAt is a real instant and keeps rendering in the viewer's zone.
  it.each([
    [MONTEVIDEO, '20 de octubre de 2026'],
    [UTC, '21 de octubre de 2026'],
  ])('keeps rendering createdAt (instant) in the viewer zone: %s shows %s', async (zone, expected) => {
    pinZone(zone)
    render(<PublicBudgetPage />)

    await waitFor(() => {
      const label = screen.getByText('Emitido el')
      expect(label.nextElementSibling).toHaveTextContent(expected)
    })
    // Sole-source: validUntil's own row is unaffected by the createdAt instant.
    expect(screen.getByText('Válido hasta').nextElementSibling).toHaveTextContent('28 de octubre de 2026')
  })
})
