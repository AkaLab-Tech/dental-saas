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

    // Default to a "repeat session" first-paint gate state (#280) so tests
    // that aren't about the gate itself (aria-labels, keyed nav labels, etc.)
    // render real content instead of the loading spinner even though
    // `settings` defaults to null above. The `language gate` describe below
    // overrides this per-test to exercise the gate itself.
    window.localStorage.setItem('accountLanguage', 'es')
  })

  afterEach(() => {
    window.localStorage.removeItem('language')
    window.localStorage.removeItem('accountLanguage')
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
  //
  // REVIEW FIX (cycle 1): the gate reads `localStorage.accountLanguage` —
  // written only once useAccountLanguage has actually applied the account's
  // settings — NOT `localStorage.language`. The latter is also written by
  // the i18next LanguageDetector (`caches: ['localStorage']`) from the
  // browser locale at i18n init, BEFORE AppLayout ever mounts, so in a real
  // browser it is never null by the time this component renders. A test
  // that removes `localStorage.language` to simulate "no cached language"
  // asserts a state production can never reach. Every test below instead
  // seeds `localStorage.language` with a detector-resolved value (as the
  // LanguageDetector always would have by this point) and gates purely on
  // the presence/absence of the `accountLanguage` marker.
  // ---------------------------------------------------------------------
  describe('language gate — first authenticated paint (#280)', () => {
    afterEach(async () => {
      window.localStorage.removeItem('language')
      window.localStorage.removeItem('accountLanguage')
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

    it('shows a loading spinner — not the sidebar/nav — on a fresh session, even though the detector has already cached a browser-resolved language', () => {
      // Reachable state: the LanguageDetector already wrote its guess into
      // localStorage.language at i18n init (this always happens before
      // AppLayout mounts in production). No accountLanguage marker exists
      // yet because this account has never had its settings applied.
      window.localStorage.setItem('language', 'en')
      window.localStorage.removeItem('accountLanguage')
      mockSettings(null)

      const { container } = renderAppLayout()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(screen.queryByText('Panel de Control')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('skips the loading gate immediately on a repeat session — the accountLanguage marker is already present, even though settings have not resolved yet this load', () => {
      window.localStorage.setItem('language', 'en')
      window.localStorage.setItem('accountLanguage', 'en')
      mockSettings(null)

      const { container } = renderAppLayout()

      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
      expect(screen.getByText('Panel de Control')).toBeInTheDocument()
    })

    it('replaces the spinner with the sidebar nav once settings resolve, on a fresh session that only had a detector-cached language', () => {
      window.localStorage.setItem('language', 'es')
      window.localStorage.removeItem('accountLanguage')
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

    it('CRITICAL (#280 regression): holds the gate — spinner shown, no detected-language nav painted — when the detector-cached language differs from the still-in-flight account settings', () => {
      // This is the exact reachable production scenario: the LanguageDetector
      // has already written its browser-resolved guess ('en') to
      // localStorage.language before this component ever mounted. No
      // accountLanguage marker exists (fresh session — settings have not
      // resolved before). i18n's active language for this test suite is
      // 'es' (top-level beforeAll/afterEach) and the account's saved
      // language will also resolve to 'es' below, differing from the
      // detector's cached 'en'.
      //
      // Against the OLD gate (`localStorage.getItem('language') !== null`)
      // this resolves truthy immediately — 'en' is in storage — so the
      // spinner would never show and the detector-resolved nav would paint
      // before settings arrive. That is the #280 bug. This test only
      // passes against the NEW `accountLanguage`-marker gate.
      window.localStorage.setItem('language', 'en')
      window.localStorage.removeItem('accountLanguage')
      mockSettings(null)

      const { container, rerender } = renderAppLayout()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
      expect(screen.queryByText('Panel de Control')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()

      mockSettings({ language: 'es', autoLockMinutes: 0 })
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <AppLayout />
        </MemoryRouter>
      )

      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
      expect(screen.getByText('Panel de Control')).toBeInTheDocument()
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
      expect(window.localStorage.getItem('accountLanguage')).toBe('es')
    })

    it('resolves to Arabic with dir=rtl once settings arrive with language "ar" — reachable state: detector cached "en", no accountLanguage marker yet', async () => {
      window.localStorage.setItem('language', 'en')
      window.localStorage.removeItem('accountLanguage')
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
      expect(window.localStorage.getItem('accountLanguage')).toBe('ar')
    })
  })
})
