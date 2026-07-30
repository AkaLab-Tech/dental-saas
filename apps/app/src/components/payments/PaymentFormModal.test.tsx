import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PaymentFormModal } from './PaymentFormModal'
import { formatCurrency } from '@/lib/format'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Helpers
// ============================================================================

function renderModal(props: Partial<Parameters<typeof PaymentFormModal>[0]> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <PaymentFormModal
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      formatCurrency={(amount) => formatCurrency(amount, 'USD')}
      {...props}
    />
  )
  return { ...utils, onClose, onSubmit }
}

async function fillAndSubmit(amount: string) {
  const amountInput = screen.getByLabelText(/monto/i)
  fireEvent.change(amountInput, { target: { value: amount } })
  const submitButton = screen.getByRole('button', { name: /guardar/i })
  fireEvent.click(submitButton)
}

// ============================================================================
// Tests
// ============================================================================

describe('PaymentFormModal', () => {
  describe('maxAmount provided (bounded)', () => {
    it('renders the capped-amount hint with the formatted max', () => {
      renderModal({ maxAmount: 150 })

      expect(screen.getByText('Máximo: USD 150.00')).toBeInTheDocument()
    })

    it('sets the native max attribute on the amount input', () => {
      renderModal({ maxAmount: 150 })

      const amountInput = screen.getByLabelText(/monto/i)
      expect(amountInput).toHaveAttribute('max', '150')
    })

    it('rejects an amount above maxAmount with a validation error and does not submit', async () => {
      const { onSubmit } = renderModal({ maxAmount: 150 })

      await fillAndSubmit('200')

      await waitFor(() => {
        expect(screen.getByText('El monto no puede exceder 150')).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('accepts an amount at exactly maxAmount (boundary)', async () => {
      const { onSubmit } = renderModal({ maxAmount: 150 })

      await fillAndSubmit('150')

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 150 })
        )
      })
    })
  })

  describe('maxAmount omitted (unbounded / advance payment)', () => {
    it('renders the advance-payment hint instead of the capped-amount hint', () => {
      renderModal()

      expect(
        screen.getByText('Puede exceder el saldo pendiente; el excedente queda como saldo a favor del paciente')
      ).toBeInTheDocument()
      expect(screen.queryByText(/Máximo:/)).not.toBeInTheDocument()
    })

    it('does not set a native max attribute on the amount input', () => {
      renderModal()

      const amountInput = screen.getByLabelText(/monto/i)
      expect(amountInput).not.toHaveAttribute('max')
    })

    it('accepts an amount that would have exceeded a typical outstanding balance', async () => {
      const { onSubmit } = renderModal()

      await fillAndSubmit('99999')

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 99999 })
        )
      })
    })
  })

  describe('amount floor (0.01), independent of maxAmount', () => {
    it('rejects a zero amount', async () => {
      const { onSubmit } = renderModal()

      await fillAndSubmit('0')

      await waitFor(() => {
        expect(screen.getByText('El monto debe ser mayor a 0')).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
