import { CheckCircle2, CircleDashed, Clock, Landmark, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type PaidStatus = 'paid' | 'charged' | 'covered' | 'mixed' | 'partial' | 'pending'

interface GetPaidStatusParams {
  isPaid: boolean
  cost: number
  // What the FIFO allocation applied to this item (charged here + covered by
  // the patient's balance).
  paidAmount?: number
  // The kind=APPOINTMENT payment recorded on this appointment (earmarked to it).
  // Only appointments have it; when absent the badge stays on the plain
  // paid/partial/pending reading (labworks, surfaces without the figure).
  recordedPaidAmount?: number
}

// paidAmount, when the caller doesn't have it, falls back to the full cost once
// paid or 0 otherwise — so partial only shows up when the caller passes a
// paidAmount. With recordedPaidAmount, a fully settled item splits by origin:
// charged = min(recorded, applied), covered = applied - charged.
export function getPaidStatus({ isPaid, cost, paidAmount, recordedPaidAmount }: GetPaidStatusParams): PaidStatus {
  const amount = paidAmount ?? (isPaid ? cost : 0)
  if (isPaid) {
    if (recordedPaidAmount === undefined) return 'paid'
    const charged = Math.min(recordedPaidAmount, amount)
    if (charged <= 0) return 'covered'
    return charged >= amount ? 'charged' : 'mixed'
  }
  if (amount > 0) return 'partial'
  return 'pending'
}

const STATUS_CONFIG: Record<PaidStatus, { icon: typeof CheckCircle2; classes: string; i18nKey: string }> = {
  paid: { icon: CheckCircle2, classes: 'bg-green-100 text-green-700', i18nKey: 'payment.paid' },
  charged: { icon: CheckCircle2, classes: 'bg-green-100 text-green-700', i18nKey: 'payment.chargedHere' },
  covered: { icon: Landmark, classes: 'bg-teal-100 text-teal-700', i18nKey: 'payment.coveredByBalance' },
  mixed: { icon: Layers, classes: 'bg-teal-100 text-teal-700', i18nKey: 'payment.chargedAndCovered' },
  partial: { icon: CircleDashed, classes: 'bg-blue-100 text-blue-700', i18nKey: 'payment.partial' },
  pending: { icon: Clock, classes: 'bg-amber-100 text-amber-700', i18nKey: 'payment.pending' },
}

const SIZE_CLASSES = {
  sm: { pill: 'px-2 py-0.5 text-xs gap-1', icon: 'h-3 w-3' },
  md: { pill: 'px-2.5 py-1 text-sm gap-1.5', icon: 'h-3.5 w-3.5' },
} as const

interface PaidStatusBadgeProps extends GetPaidStatusParams {
  size?: keyof typeof SIZE_CLASSES
}

export function PaidStatusBadge({ isPaid, cost, paidAmount, recordedPaidAmount, size = 'sm' }: PaidStatusBadgeProps) {
  const { t } = useTranslation()
  const status = getPaidStatus({ isPaid, cost, paidAmount, recordedPaidAmount })
  const { icon: Icon, classes, i18nKey } = STATUS_CONFIG[status]
  const { pill, icon } = SIZE_CLASSES[size]

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${classes} ${pill}`}>
      <Icon className={icon} />
      {t(i18nKey)}
    </span>
  )
}
