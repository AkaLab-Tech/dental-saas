// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Header } from './Header'

const NAV_LABELS: Record<string, string> = {
  'nav.home': 'Inicio',
  'nav.pricing': 'Precios',
  'nav.features': 'Características',
  'nav.openMenu': 'Abrir menú',
  'nav.closeMenu': 'Cerrar menú',
  'cta.login': 'Iniciar Sesión',
  'cta.startFree': 'Comenzar Gratis',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => NAV_LABELS[key] ?? key,
    i18n: {
      language: 'es',
      resolvedLanguage: 'es',
      changeLanguage: vi.fn(),
    },
  }),
  // Header -> LanguageSelector imports `languages` from ../i18n, whose
  // module-level side effect calls i18n.use(initReactI18next); the mock
  // module needs to export a stub plugin so that .use() call does not throw.
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  )
}

describe('Header', () => {
  // apps/web has no vitest `test.globals`, so @testing-library/react's
  // automatic afterEach(cleanup) never registers; do it explicitly.
  afterEach(() => {
    cleanup()
  })

  it('renders the translated nav links and CTAs', () => {
    renderHeader()

    // getAllByText because the mobile menu duplicates the desktop nav
    expect(screen.getAllByText('Inicio').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Precios').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Características').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Iniciar Sesión').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Comenzar Gratis').length).toBeGreaterThan(0)
  })

  it('renders the language selector on the landing header', () => {
    renderHeader()

    // Two instances: desktop bar + mobile menu, per Header.tsx's markup.
    const selectors = screen.getAllByRole('combobox', { name: 'Language' })
    expect(selectors.length).toBe(2)
  })

  it('renders the Alveodent brand link', () => {
    renderHeader()

    expect(screen.getByText('Alveodent')).toBeInTheDocument()
  })
})
