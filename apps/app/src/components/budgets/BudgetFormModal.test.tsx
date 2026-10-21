import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { BudgetFormModal } from './BudgetFormModal'
import { USER_SETTABLE_BUDGET_STATUSES } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

const onSubmit = vi.fn()

function openForm() {
  render(<BudgetFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />)
  fireEvent.change(screen.getByPlaceholderText(i18n.t('budgets.items.descriptionPlaceholder')), {
    target: { value: 'Limpieza' },
  })
}

async function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  return onSubmit.mock.calls[0][0]
}

describe('BudgetFormModal status (#606)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onSubmit.mockResolvedValue(undefined)
  })

  it('sends the chosen non-default status in the create payload', async () => {
    openForm()
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'APPROVED' } })
    expect(screen.getByLabelText('Estado')).toHaveValue('APPROVED')
    const payload = await submit()
    expect(payload.status).toBe('APPROVED')
  })

  it('sends CANCELLED when that is chosen', async () => {
    openForm()
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'CANCELLED' } })
    expect(screen.getByLabelText('Estado')).toHaveValue('CANCELLED')
    const payload = await submit()
    expect(payload.status).toBe('CANCELLED')
  })

  it('defaults to DRAFT in the payload when nothing is chosen', async () => {
    openForm()
    expect(screen.getByLabelText('Estado')).toHaveValue('DRAFT')
    const payload = await submit()
    expect(payload.status).toBe('DRAFT')
  })

  it('offers exactly the shared settable list', () => {
    openForm()
    const values = Array.from((screen.getByLabelText('Estado') as HTMLSelectElement).options).map(
      (o) => o.value
    )
    expect(values).toEqual([...USER_SETTABLE_BUDGET_STATUSES])
  })
})
