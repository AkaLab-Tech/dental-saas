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
  setAutoLockMinutes: (minutes: number) => void
}> = {}) {
  const state = {
    isLocked: false,
    autoLockMinutes: 0,
    activeUser: null,
    fetchProfiles: vi.fn(),
    setAutoLockMinutes: vi.fn(),
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

  // ---------------------------------------------------------------------
  // Task #280 (follow-up to #210) — the account's saved language must be
  // resolved before the sidebar/content ever paints, so the nav never shows
  // the browser/detector-resolved language before flipping to the account's
  // saved one. useAccountLanguage (mocked away above via the real module —
  // it is NOT mocked here, so the real hook runs against the real i18n
  // singleton) is the single path allowed to call changeLanguage for this.
  // ---------------------------------------------------------------------
  describe('language gate — first authenticated paint (#280)', () => {
    afterEach(async () => {
      window.localStorage.removeItem('language')
      await act(async () => {
        await i18n.changeLanguage('es')
      })
      document.documentElement.dir = 'ltr'
      document.documentElement.lang = 'es'
    })

    function mockSettings(settings: { language: string; autoLockMinutes: number } | null) {
      ;(useSettingsStore as unknown as Mock).mockImplementation(
        (selector: (s: { settings: typeof settings; fetchSettings: () => void }) => unknown) =>
          selector({ settings, fetchSettings: vi.fn() })
      )
    }

    it('shows a loading spinner — not the sidebar/nav — when settings have not resolved and no language is cached', () => {
      window.localStorage.removeItem('language')
      mockSettings(null)

      const { container } = renderAppLayout()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(screen.queryByText('Panel de Control')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('skips the loading gate when a language is already cached, even though settings have not resolved yet', () => {
      window.localStorage.setItem('language', 'en')
      mockSettings(null)

      const { container } = renderAppLayout()

      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
      expect(screen.getByText('Panel de Control')).toBeInTheDocument()
    })

    it('replaces the spinner with the sidebar nav once settings resolve to the SAME language i18n already has', () => {
      window.localStorage.removeItem('language')
      mockSettings(null)

      const { container, rerender } = renderAppLayout()
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()

      mockSettings({ language: 'es', autoLockMinutes: 0 })
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <AppLayout />
        </MemoryRouter>
      )

      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
      expect(screen.getByText('Panel de Control')).toBeInTheDocument()
    })

    it('never paints the stale/detected-language nav when settings resolve to a DIFFERENT language on the first authenticated paint', () => {
      // Current i18n.language is 'es' (set in the top-level beforeAll/afterEach
      // of this suite) — simulating the browser/detector-resolved locale.
      // The account's saved language ('en') differs. This is exactly the
      // #280 scenario: no cached language yet, and the account preference
      // disagrees with the detected one.
      window.localStorage.removeItem('language')
      mockSettings(null)

      const { container, rerender } = renderAppLayout()
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(i18n.language).toBe('es')

      mockSettings({ language: 'en', autoLockMinutes: 0 })
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <AppLayout />
        </MemoryRouter>
      )

      // The very first frame that shows real content must never be the
      // stale Spanish nav — it must already be English, or the gate must
      // still be showing the spinner. What must NEVER happen is painting
      // "Panel de Control" (Spanish) once settings/content are shown.
      const showsSpinner = container.querySelector('.animate-spin') !== null
      const showsStaleSpanishNav = screen.queryByText('Panel de Control') !== null
      expect(showsStaleSpanishNav).toBe(false)
      if (!showsSpinner) {
        expect(screen.getByText('Dashboard')).toBeInTheDocument()
      }
    })

    it('resolves to Arabic with dir=rtl once settings arrive with language "ar", with no interim spinner-less wrong-language paint', async () => {
      window.localStorage.removeItem('language')
      mockSettings(null)

      const { container, rerender } = renderAppLayout()
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()

      mockSettings({ language: 'ar', autoLockMinutes: 0 })
      await act(async () => {
        rerender(
          <MemoryRouter initialEntries={['/']}>
            <AppLayout />
          </MemoryRouter>
        )
        // Flush the changeLanguage('ar') promise chain kicked off by
        // useAccountLanguage so i18n.language settles and document
        // direction updates.
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.queryByText('Panel de Control')).not.toBeInTheDocument()
      expect(document.documentElement.dir).toBe('rtl')
      expect(document.documentElement.lang).toBe('ar')
      expect(window.localStorage.getItem('language')).toBe('ar')
    })
  })
})
