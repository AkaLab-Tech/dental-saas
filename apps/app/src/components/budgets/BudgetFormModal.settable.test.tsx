import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { BudgetFormModal } from './BudgetFormModal'

// The shared constant gains a value (PARTIAL stands in for "a status added
// later"). A form validating against a hand-written enum would offer it in the
// select and then silently reject the submit; the schema must follow the constant.
vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    USER_SETTABLE_BUDGET_STATUSES: [...actual.USER_SETTABLE_BUDGET_STATUSES, 'PARTIAL'] as const,
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const onSubmit = vi.fn()

describe('BudgetFormModal schema follows the shared settable list (#606)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onSubmit.mockResolvedValue(undefined)
  })

  it('accepts and submits a status added to the shared constant', async () => {
    render(<BudgetFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText(i18n.t('budgets.items.descriptionPlaceholder')), {
      target: { value: 'Limpieza' },
    })
    const select = screen.getByLabelText('Estado') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toContain('PARTIAL')
    fireEvent.change(select, { target: { value: 'PARTIAL' } })
    expect(select).toHaveValue('PARTIAL')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].status).toBe('PARTIAL')
  })
})
