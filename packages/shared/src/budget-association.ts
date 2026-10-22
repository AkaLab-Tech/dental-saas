/**
 * Which budget statuses an appointment may be associated to. One definition,
 * read by the API (the rejection) and the app (the picker).
 *
 * - APPROVED, PARTIAL: accepted by the patient and still open -> associable.
 * - DRAFT: not accepted yet -> not associable.
 * - CANCELLED: dead -> not associable.
 * - COMPLETED: every line is executed -> not associable. Decided on purpose:
 *   the item-level check would reject it today only as a side effect.
 */
export const ASSOCIABLE_BUDGET_STATUSES = ['APPROVED', 'PARTIAL'] as const

export function isBudgetAssociable(status: string): boolean {
  return (ASSOCIABLE_BUDGET_STATUSES as readonly string[]).includes(status)
}
