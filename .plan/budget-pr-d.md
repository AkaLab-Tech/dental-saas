# Plan — Budget Epic PR D (Story 5): Appointment integration with doctor confirmation

> Manual ROADMAP task (High/Med/Low). Schema already DONE (no migration). Greenfield on finished schema.
> Decomposed into 4 sub-PRs: D-1 backend, D-2 associate UI, D-3 completion UI, D-4 e2e.

## Schema (already present — verify only)
- `BudgetItemAppointment` (schema.prisma:626-645): budgetItemId, appointmentId, role (default SCHEDULED), notes, createdById; `@@unique([budgetItemId, appointmentId, role])` → same item+appointment can hold BOTH a SCHEDULED and an EXECUTED row (confirm = ADD an EXECUTED row).
- `BudgetItemStatus`: PENDING SCHEDULED IN_PROGRESS EXECUTED CANCELLED. `BudgetItemAppointmentRole`: SCHEDULED EXECUTED.
- Relations: `Appointment.budgetItemAppointments` (383), `BudgetItem.appointments` (615). NO app code touches the join table yet.

## Key reuse points
- `budget.service.ts`: `deriveBudgetStatus` (135-155, DRAFT/CANCELLED sticky, PARTIAL only from APPROVED) already implements the needed semantics; `recalculateBudgetAggregates` (160-184) is the recalc reuse point — must be EXPORTED. `BudgetErrorCode.INVALID_STATUS_TRANSITION` exists.
- `appointment.service.ts`: completion = `markAppointmentDone` (781-814, sets status=COMPLETED + notes). Routes: `appointments.ts` create (284, CLINIC_ADMIN), update (324, DOCTOR + ownership), mark-done (377, CLINIC_ADMIN); schemas 51-81. `mapErrorCodeToStatus` present.
- Frontend: `AppointmentFormModal.tsx` (create/edit; add multi-select here). Completion has NO form — `AppointmentsPage.handleComplete` (140) + `PatientAppointmentsSection` (375) call complete directly (add a modal). API clients: `appointment-api.ts` (markAppointmentDone 269), `budget-api.ts` (listBudgetsByPatient 103 returns items). Store: `appointments.store.ts` completeAppointment (252).
- i18n: `apps/app/src/i18n/locales/{es,en,ar}.json` under `appointments.*` (budgets.itemStatus.SCHEDULED/EXECUTED already translated).
- Tests: `appointments.test.ts` (supertest+real prisma+JWT) is the authoritative full-flow home. Playwright e2e has no auth bootstrap → specs skip at /login.

## DECISIONS (operator-default, adopted 2026-07-03 — overridable later)
1. RBAC: keep existing appointment role gates unchanged; ADD `Permission.BUDGETS_UPDATE` on the item-transition logic (DOCTOR has it). Do not lower mark-done role.
2. PARTIAL requires APPROVED budget (deriveBudgetStatus keeps DRAFT sticky). Tests create APPROVED budgets. No DRAFT auto-promote.
3. Unassociate reverts only PENDING↔SCHEDULED; an item with any EXECUTED row is NOT reverted. IN_PROGRESS terminal for the unassociate path.
4. Replace-set semantics on update: `budgetItemIds` undefined = leave associations untouched; `[]` = clear all SCHEDULED associations.
5. All mutations in `prisma.$transaction`, tenant-scoped (appointment.tenantId === tenantId; items via budget.tenantId + isActive), recalc affected budgets in-tx. Handle P2002 idempotently.
6. Authoritative criterion-#8 test = D-1 supertest full-flow. D-4 e2e = graceful-skip UI smoke (no auth-bootstrap investment).
7. Eligible items on create/edit = patient's non-CANCELLED budgets' items in PENDING/SCHEDULED (client-filtered from listBudgetsByPatient).

## D-1 — Backend (this PR)
Create `apps/api/src/services/budget-appointment.service.ts`:
- `setAppointmentBudgetItems(tenantId, appointmentId, itemIds[], userId)` — replace-set: link new (PENDING/SCHEDULED → SCHEDULED + upsert join role=SCHEDULED), unlink removed (delete SCHEDULED join, item → PENDING iff no EXECUTED row), recalc affected budgets.
- `confirmExecutedBudgetItems(tenantId, appointmentId, itemIds[], userId)` — items currently SCHEDULED-linked to THIS appointment → status EXECUTED + upsert join role=EXECUTED; unlisted stay SCHEDULED; recalc.
- `getAppointmentBudgetItems(tenantId, appointmentId)` — associated items + role for hydration.
Edit `budget.service.ts` (export recalculateBudgetAggregates). Edit `appointments.ts`: optional `budgetItemIds` on create/update schemas, optional `executedBudgetItemIds` on markDoneSchema, call the link service after the appointment write, add `GET /:id/budget-items`, gate item paths on BUDGETS_UPDATE, extend error mapping.
Tests: associate→SCHEDULED, unassociate→PENDING, mark-done subset→EXECUTED + rest SCHEDULED, empty executed list = no auto-exec, cross-tenant reject, full-flow budget APPROVED→PARTIAL→COMPLETED.

## D-2/D-3/D-4 (later PRs) — see decomposition in session notes.
