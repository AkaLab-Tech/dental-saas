import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PaidStatusBadge, getPaidStatus } from './PaidStatusBadge'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// getPaidStatus — pure derivation
// ============================================================================

describe('getPaidStatus', () => {
  it('returns "paid" when isPaid is true, regardless of paidAmount', () => {
    expect(getPaidStatus({ isPaid: true, cost: 100 })).toBe('paid')
  })

  it('returns "paid" when isPaid is true even if paidAmount is 0 (isPaid wins over the amount)', () => {
    expect(getPaidStatus({ isPaid: true, cost: 100, paidAmount: 0 })).toBe('paid')
  })

  it('returns "paid" for a zero-cost, fully-paid item (cost boundary)', () => {
    expect(getPaidStatus({ isPaid: true, cost: 0 })).toBe('paid')
  })

  it('returns "partial" when isPaid is false and paidAmount is greater than 0', () => {
    expect(getPaidStatus({ isPaid: false, cost: 100, paidAmount: 50 })).toBe('partial')
  })

  it('returns "partial" when paidAmount reaches the full cost but isPaid is still false', () => {
    // isPaid is the source of truth for "paid"; a caller that has not yet set
    // isPaid but has recorded the full amount reads as partial, not paid.
    expect(getPaidStatus({ isPaid: false, cost: 100, paidAmount: 100 })).toBe('partial')
  })

  it('returns "partial" when paidAmount exceeds the cost but isPaid is false (overpayment)', () => {
    expect(getPaidStatus({ isPaid: false, cost: 50, paidAmount: 80 })).toBe('partial')
  })

  it('returns "pending" when isPaid is false and paidAmount is exactly 0', () => {
    expect(getPaidStatus({ isPaid: false, cost: 100, paidAmount: 0 })).toBe('pending')
  })

  it('returns "pending" — never "partial" — when isPaid is false and paidAmount is undefined (binary fallback)', () => {
    expect(getPaidStatus({ isPaid: false, cost: 100 })).toBe('pending')
  })

  it('returns "pending" for a zero-cost, unpaid item with no paidAmount', () => {
    expect(getPaidStatus({ isPaid: false, cost: 0 })).toBe('pending')
  })
})

// ============================================================================
// <PaidStatusBadge> — label + icon per state
// ============================================================================
//
// Icon presence is asserted via lucide-react's per-icon CSS class
// (`lucide-circle-check` / `lucide-circle-dashed` / `lucide-clock`), which is
// distinct per icon and independent of the pill's background colour class —
// this is the "not colour alone" signal the task calls for.

describe('PaidStatusBadge', () => {
  it('renders the "Pagado" label and the check-circle icon for the paid state', () => {
    const { container } = render(<PaidStatusBadge isPaid cost={100} />)

    expect(screen.getByText('Pagado')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-circle-check')).not.toBeNull()
    expect(container.querySelector('svg.lucide-circle-dashed')).toBeNull()
    expect(container.querySelector('svg.lucide-clock')).toBeNull()
  })

  it('renders the "Parcial" label and the dashed-circle icon for the partial state', () => {
    const { container } = render(<PaidStatusBadge isPaid={false} cost={100} paidAmount={50} />)

    expect(screen.getByText('Parcial')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-circle-dashed')).not.toBeNull()
    expect(container.querySelector('svg.lucide-circle-check')).toBeNull()
    expect(container.querySelector('svg.lucide-clock')).toBeNull()
  })

  it('renders the "Pendiente" label and the clock icon for the pending state', () => {
    const { container } = render(<PaidStatusBadge isPaid={false} cost={100} />)

    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-clock')).not.toBeNull()
    expect(container.querySelector('svg.lucide-circle-check')).toBeNull()
    expect(container.querySelector('svg.lucide-circle-dashed')).toBeNull()
  })

  it('defaults to the "sm" size classes when size is not passed', () => {
    const { container } = render(<PaidStatusBadge isPaid cost={100} />)

    const icon = container.querySelector('svg.lucide-circle-check')
    expect(icon).toHaveClass('h-3', 'w-3')
  })

  it('applies the "md" size classes when size="md" is passed', () => {
    const { container } = render(<PaidStatusBadge isPaid cost={100} size="md" />)

    const icon = container.querySelector('svg.lucide-circle-check')
    expect(icon).toHaveClass('h-3.5', 'w-3.5')
  })
})
