import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { AppLayout } from './AppLayout'
import { useAuthStore } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'
import { useSettingsStore } from '@/stores/settings.store'
import { usePermissions } from '@/hooks/usePermissions'

// AppLayout's mobile sidebar toggle buttons now render their aria-labels
// through t() (task #331). Initialize the real i18n instance (Spanish, the
// app default) so assertions exercise the actual translated output rather
// than raw keys or jsdom's default `en` locale detection — mirrors the
// pattern used by LabworksPage.test.tsx / DoctorsPage.test.tsx (#325/#326)
// and SettingsPage.test.tsx (#331).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('@/stores/lock.store')
vi.mock('@/stores/settings.store')
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))
vi.mock('@/hooks/useInactivityTimer', () => ({
  useInactivityTimer: vi.fn(),
}))
vi.mock('@/components/auth/LockScreen', () => ({
  LockScreen: () => <div data-testid="lock-screen" />,
}))
vi.mock('@/components/auth/PinSetupModal', () => ({
  PinSetupModal: () => <div data-testid="pin-setup-modal" />,
}))
vi.mock('@/lib/api', () => ({
  authApi: { logout: vi.fn() },
}))

const mockUser = {
  id: 'user-1',
  email: 'owner@test.com',
  firstName: 'Test',
  lastName: 'Owner',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  hasPinSet: true,
}

function mockLockStoreState(overrides: Partial<{
  isLocked: boolean
  autoLockMinutes: number
  activeUser: unknown
  fetchProfiles: () => void
}> = {}) {
  const state = {
    isLocked: false,
    autoLockMinutes: 0,
    activeUser: null,
    fetchProfiles: vi.fn(),
    ...overrides,
  }
  ;(useLockStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state)
  )
  ;(useLockStore as unknown as Mock & { getState: Mock }).getState = vi.fn(() => ({
    lock: vi.fn(),
  }))
  return state
}

function renderAppLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppLayout />
    </MemoryRouter>
  )
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: true,
      user: mockUser,
      logout: vi.fn(),
      refreshToken: 'refresh-token',
    })

    ;(useSettingsStore as unknown as Mock).mockImplementation(
      (selector: (s: { settings: null; fetchSettings: () => void }) => unknown) =>
        selector({ settings: null, fetchSettings: vi.fn() })
    )

    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })

    mockLockStoreState()
  })

  it('sets the "Abrir menú" aria-label on the mobile open-sidebar button via nav.openMenu', () => {
    renderAppLayout()

    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeInTheDocument()
  })

  it('sets the "Cerrar menú" aria-label on the mobile close-sidebar button via nav.closeMenu', () => {
    renderAppLayout()

    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toBeInTheDocument()
  })

  it('resolves the open/close menu aria-labels to English when the locale is en', async () => {
    renderAppLayout()

    await act(async () => {
      await i18n.changeLanguage('en')
    })

    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('es')
    })
  })

  it('renders already-keyed nav labels unchanged (e.g. nav.dashboard, nav.logout)', () => {
    renderAppLayout()

    expect(screen.getByText('Panel de Control')).toBeInTheDocument()
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument()
  })
})
