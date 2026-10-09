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

// ============================================================================
// Task #524 — "charged in this consultation" vs "covered by an advance"
// ============================================================================
//
// The tuples below are exactly the (isPaid, cost, paidAmount,
// recordedPaidAmount) quadruples the API PRODUCES for the four acceptance
// cases — see apps/api/src/routes/appointments-paid-badge-figures.test.ts,
// which builds the real rows and asserts the same figures. This block is the
// other half of that contract: given those figures, which state results.

describe('getPaidStatus — charged vs covered (#524)', () => {
  it('case 1: cost 3000, nothing charged and no advance -> "pending"', () => {
    expect(getPaidStatus({ isPaid: false, cost: 3000, paidAmount: 0, recordedPaidAmount: 0 })).toBe('pending')
  })

  it('case 2: cost 3000 covered by a 3000 advance (recorded 0) -> "covered", not "charged"', () => {
    expect(getPaidStatus({ isPaid: true, cost: 3000, paidAmount: 3000, recordedPaidAmount: 0 })).toBe('covered')
  })

  it('case 3: cost 2000 with 2000 charged in the consultation -> "charged"', () => {
    expect(getPaidStatus({ isPaid: true, cost: 2000, paidAmount: 2000, recordedPaidAmount: 2000 })).toBe('charged')
  })

  it('case 4: cost 5000, 2000 charged while 3000 of credit exists -> "mixed" (neither "charged" nor "covered")', () => {
    const status = getPaidStatus({ isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 2000 })
    expect(status).toBe('mixed')
    expect(status).not.toBe('charged')
    expect(status).not.toBe('covered')
  })

  it('a partly charged item that is still unpaid stays "partial", whatever was charged', () => {
    expect(getPaidStatus({ isPaid: false, cost: 5000, paidAmount: 2000, recordedPaidAmount: 2000 })).toBe('partial')
  })

  it('charged is capped at what was applied: recorded above the applied amount reads "charged", not "mixed"', () => {
    expect(getPaidStatus({ isPaid: true, cost: 2000, paidAmount: 2000, recordedPaidAmount: 3500 })).toBe('charged')
  })

  it('one unit of credit under the cost flips "charged" to "mixed" (boundary)', () => {
    expect(getPaidStatus({ isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 4999 })).toBe('mixed')
    expect(getPaidStatus({ isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 5000 })).toBe('charged')
    expect(getPaidStatus({ isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 1 })).toBe('mixed')
    expect(getPaidStatus({ isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 0 })).toBe('covered')
  })

  it('without recordedPaidAmount the reading stays the two-state "paid"/"pending" (AppointmentCard, doctor list, labworks)', () => {
    expect(getPaidStatus({ isPaid: true, cost: 100 })).toBe('paid')
    expect(getPaidStatus({ isPaid: true, cost: 100, paidAmount: 100 })).toBe('paid')
    expect(getPaidStatus({ isPaid: false, cost: 100 })).toBe('pending')
  })
})

describe('PaidStatusBadge — charged vs covered labels (#524)', () => {
  const cases = [
    { name: 'case 1', props: { isPaid: false, cost: 3000, paidAmount: 0, recordedPaidAmount: 0 }, label: 'Pendiente', icon: 'lucide-clock' },
    { name: 'case 2', props: { isPaid: true, cost: 3000, paidAmount: 3000, recordedPaidAmount: 0 }, label: 'Cubierto por saldo', icon: 'lucide-landmark' },
    { name: 'case 3', props: { isPaid: true, cost: 2000, paidAmount: 2000, recordedPaidAmount: 2000 }, label: 'Cobrado en la consulta', icon: 'lucide-circle-check' },
    { name: 'case 4', props: { isPaid: true, cost: 5000, paidAmount: 5000, recordedPaidAmount: 2000 }, label: 'Cobrado + saldo', icon: 'lucide-layers' },
  ]

  it.each(cases)('$name renders "$label" with the $icon icon', ({ props, label, icon }) => {
    const { container } = render(<PaidStatusBadge {...props} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.querySelector(`svg.${icon}`)).not.toBeNull()
    // The generic label must be gone: that is the whole point of the task.
    expect(screen.queryByText('Pagado')).not.toBeInTheDocument()
  })

  it('the four cases render four distinct labels', () => {
    const labels = cases.map(({ props }) => {
      const { container, unmount } = render(<PaidStatusBadge {...props} />)
      const text = container.textContent
      unmount()
      return text
    })
    expect(new Set(labels).size).toBe(4)
  })
})
