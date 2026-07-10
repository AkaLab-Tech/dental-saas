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

// Submits by dispatching the form's `submit` event directly rather than
// clicking the submit button. Clicking would trigger the browser's native
// HTML5 constraint validation (min/max on the <input type="number">), which
// blocks the "submit" event entirely for genuinely out-of-range values —
// masking the Zod-level message this suite is pinning down. Dispatching
// `submit` still runs react-hook-form's zodResolver exactly the same way.
async function fillAndSubmit(container: HTMLElement, amount: string) {
  const amountInput = screen.getByLabelText(/monto/i)
  fireEvent.change(amountInput, { target: { value: amount } })
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
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
      const { onSubmit, container } = renderModal({ maxAmount: 150 })

      await fillAndSubmit(container, '200')

      await waitFor(() => {
        expect(screen.getByText('El monto no puede exceder 150')).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('accepts an amount at exactly maxAmount (boundary)', async () => {
      const { onSubmit, container } = renderModal({ maxAmount: 150 })

      await fillAndSubmit(container, '150')

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
      const { onSubmit, container } = renderModal()

      await fillAndSubmit(container, '99999')

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 99999 })
        )
      })
    })
  })

  describe('amount floor (0.01), independent of maxAmount', () => {
    it('rejects a zero amount', async () => {
      const { onSubmit, container } = renderModal()

      await fillAndSubmit(container, '0')

      await waitFor(() => {
        expect(screen.getByText('El monto debe ser mayor a 0')).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
