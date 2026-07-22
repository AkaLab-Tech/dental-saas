import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { DataExportForm } from './DataExportForm'
import { exportData } from '@/lib/export-api'

// DataExportForm's non-Error export failure message now renders through
// t('settings.exportError') (task #331). Initialize the real i18n instance
// (Spanish, the app default) so assertions exercise the actual translated
// output rather than raw keys or jsdom's default `en` locale detection —
// mirrors the pattern used by LabworksPage.test.tsx / DoctorsPage.test.tsx
// (#325/#326) and SettingsPage.test.tsx (#331).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

vi.mock('@/lib/export-api', () => ({
  exportData: vi.fn(),
}))

describe('DataExportForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the translated fallback error message via settings.exportError when exportData rejects with a non-Error value', async () => {
    vi.mocked(exportData).mockRejectedValue('boom')

    render(<DataExportForm />)

    fireEvent.click(screen.getByRole('button', { name: /descargar datos/i }))

    await waitFor(() => {
      expect(screen.getByText('Error al exportar datos')).toBeInTheDocument()
    })
  })

  it('shows the actual Error message (not the t() fallback) when exportData rejects with an Error instance', async () => {
    vi.mocked(exportData).mockRejectedValue(new Error('Network timeout'))

    render(<DataExportForm />)

    fireEvent.click(screen.getByRole('button', { name: /descargar datos/i }))

    await waitFor(() => {
      expect(screen.getByText('Network timeout')).toBeInTheDocument()
    })
    expect(screen.queryByText('Error al exportar datos')).not.toBeInTheDocument()
  })

  it('resolves settings.exportError to English when the locale is en (surrounding copy is not yet migrated and stays Spanish)', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    vi.mocked(exportData).mockRejectedValue('boom')

    render(<DataExportForm />)

    // Only the error string was migrated by this task; the button label
    // itself is still the hardcoded Spanish literal "Descargar Datos".
    fireEvent.click(screen.getByRole('button', { name: /descargar datos/i }))

    await waitFor(() => {
      expect(screen.getByText('Error exporting data')).toBeInTheDocument()
    })

    await act(async () => {
      await i18n.changeLanguage('es')
    })
  })

  it('does not show any error message before exporting', () => {
    render(<DataExportForm />)

    expect(screen.queryByText('Error al exportar datos')).not.toBeInTheDocument()
  })
})
