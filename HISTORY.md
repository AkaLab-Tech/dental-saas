# History

Completed work log. Tasks flow: `ROADMAP.md` → `IN_PROGRESS.md` → `HISTORY.md`.

Newest first. Each entry references the PR(s) that delivered the work.

---

## 2026-06

### Security: kiosk `logout()` lock-store leak (privilege escalation) — 2026-06-23
**PR:** _(this PR)_

**Report:** After a PIN-unlock, `logout()` reset `dental-auth` but left the lock store (`dental-lock` in `sessionStorage`: `isLocked`, `profileToken`, `activeUser`) intact. On a shared device, when user A (e.g. OWNER) PIN-unlocked then logged out and user B (e.g. DOCTOR) logged in **in the same tab**, A's `profileToken` + `activeUser` leaked into B's session: `api.ts` sent A's `x-profile-token`, so the auth middleware overrode B's role with A's — B operated with A's higher privileges until the token expired. Found via prod E2E on 2026-06-23; introduced by the #195 PIN/kiosk re-land.

**Fix:**
- `useAuthStore.logout()` now calls `useLockStore.getState().reset()` before clearing auth state. `reset()` already existed (sets `isLocked=false`, `profileToken=null`, `activeUser=null`); it was simply never wired into logout.
- Centralized in the store action rather than per call site: there are three logout paths (`useAuth` hook, `AppLayout`, `LockScreen`), and two call `useAuthStore().logout()` directly — fixing the action covers all of them and prevents future callers from reintroducing the leak.
- The cross-store import is a deferred, in-function reference (same module-cycle pattern already used by `api.ts`), so it carries no load-order risk.

**Tests:** New regression test in `auth.store.test.ts` seeds the lock store with another user's token/`activeUser`/`isLocked=true`, calls logout, and asserts all three are cleared. Full app suite green (988 passing), lint clean, typecheck clean.

---

## 2026-04

### Patient Budgets — post-PR B polish (status dropdown) — 2026-04-29
**PR:** [#181](https://github.com/Miguelslo27/dental-saas/pull/181)

Closes the only follow-up from PR #177 before starting PR C (PDF + public share link).

- `BudgetDetailPage` status dropdown now exposes only the user-settable values (`DRAFT`, `APPROVED`, `CANCELLED`). `PARTIAL` and `COMPLETED` are auto-derived by `deriveBudgetStatus` in `budget.service.ts` and normalized on every write, so picking them was a silent no-op.
- When the current budget is already in an auto-derived state, that value is rendered as a `disabled` option so the `<select>` still reflects the real status.
- No backend changes; no new tests (component had none — the change is a small render-only filter).

---

### Hotfix: Appointment "Paid" checkbox + FIFO breakdown — 2026-04-27
**PR:** [#179](https://github.com/Miguelslo27/dental-saas/pull/179)

**Original report:** A patient had her treatment, the appointment was created with a cost and the "Paid" checkbox was ticked, but on save the appointment kept showing as pending. While investigating, several adjacent FIFO bugs surfaced and got fixed in the same branch.

**Delivered:**

- **Marking as paid on update now actually pays.** `updateAppointment` used to discard `isPaid` because the column is derived. It now triggers the same FIFO auto-payment flow as create. Reverting paid → unpaid is rejected with `CANNOT_UNMARK_PAID`; the UI disables the checkbox in that case.
- **Auto-payment errors are no longer silent.** `createAppointment` previously logged a warning and returned the appointment as if everything worked. The API now surfaces `EXCEEDS_BALANCE` / `PAYMENT_FAILED` to the client.
- **Auto-payment is capped at the outstanding balance.** Patients with prior credit (advance payments) used to crash with `EXCEEDS_BALANCE`. Both create and update now share `applyPaidTransition` which creates a payment for `min(cost, outstanding)`, or skips and just reruns FIFO when the existing credit already covers the appointment.
- **Payments section refreshes after appointment changes.** Saving an appointment with `isPaid=true` left balance / total paid / payment list stale. New `paymentsRefreshKey` on `PatientDetailPage` is bumped on appointment submit; reverse path also wired (creating/deleting a payment refreshes the appointments section).
- **Partial-paid state on appointment cards.** Per-patient endpoints now expose `paidAmount` and `outstanding` per appointment via a new `computeFifoAllocation` helper. The card renders three states: `Pagado` (green), `Parcial` blue + "Aplicado: $X de $Y", `Pendiente` (amber). `recalculatePaidStatus` was refactored onto the same helper, switching to **strict FIFO** (a partial payment exhausts itself on the older item instead of "skipping" to a cheaper later one). `isPaid` exposed by the per-patient endpoints is the FIFO-derived value, not the persisted column, so the UI never shows a stale view.
- i18n (es / en / ar): paid hint, already-paid hint, error codes (`cannotUnmarkPaid`, `exceedsBalance`, `paymentFailed`), partial label, "Aplicado: X de Y" line.

**Tests:** 70 appointment route tests + 22 payment route tests + 11 labwork route tests pass; frontend 978/978; lint clean. Two pre-existing failures in `admin/stats.test.ts` also fail on `main` (unrelated).

**Production verification (2026-06-03):** Re-confirmed with the Playwright MCP on `app.alveodent.com` that this fix is live. Editing an unpaid appointment to tick "Paid" persists and creates the FIFO entrega; a paid appointment's edit form shows the disabled checkbox + revert hint; deleting the entrega reverts the card to pending and refreshes the ficha. The lingering ROADMAP "payment edits don't persist" bug entry (a pre-#179 report) was retired as resolved.

**Follow-ups:**
- Extend `paidAmount` / `outstanding` to other appointment endpoints (global list, calendar, by-doctor).
- Apply the same FIFO breakdown to labworks. The shared helpers (`computeFifoAllocation`, `listBillableItems`, `getTotalPaid`) are already exported from `payment.service` for that purpose.

---

### Patient Budgets — frontend CRUD (PR B) — 2026-04-23
**PR:** [#177](https://github.com/Miguelslo27/dental-saas/pull/177)

Second PR of the Patient Budgets epic. Lets OWNER / ADMIN / DOCTOR create, view, edit and delete presupuestos from the patient detail page, with STAFF read-only and DOCTOR unable to delete the budget itself (matches backend RBAC from PR #176).

- `budget-api.ts` client with 8 CRUD functions + `getExecutedItemsCount` helper
- Zustand `budgets.store.ts` scoped to a patient's list plus a `currentBudget` for detail view; replaces the budget wholesale on every item mutation (backend returns the full budget every time)
- `BudgetsSection` on `PatientDetailPage` with list, create, delete
- `BudgetCard` with status badge, progress bar (X/Y executed), actions menu gated by `usePermissions()`
- `BudgetFormModal` — one-shot creation with inline items via `useFieldArray` and Zod validation mirroring backend constraints
- `BudgetDetailPage` at `/patients/:patientId/budgets/:id` — granular editing of metadata + add/edit/delete items + item status transitions
- i18n keys `budgets.*` in ES / EN / AR + missing `common.status`
- 22 new frontend tests (budget-api + store + BudgetCard permission gating)

**Design decisions:**
- Detail view as a dedicated page (shareable URL + history) instead of a modal
- Items inline in the create modal (single `POST`) — no multi-step UX
- Creation = modal; editing = detail page. Each backend endpoint handles its own concern; no client-side diff-and-dispatch
- UI permissions mirror backend RBAC for immediate feedback

**Follow-ups (tracked in `IN_PROGRESS.md` → Post-PR B polish):**
- Hide auto-derived budget statuses (`PARTIAL`, `COMPLETED`) from the manual dropdown — discovered during local smoke testing; backend silently normalizes them so the UI made it look like "save" did nothing.

---

### Patient Budgets — data model + backend (PR A) — 2026-04-21
**PR:** [#176](https://github.com/Miguelslo27/dental-saas/pull/176)

First PR of the Patient Budgets epic. Ships data model, RBAC, service and routes with full integration test coverage. No frontend.

**Data model:**
- New Prisma models: `Budget`, `BudgetItem`, `BudgetItemAppointment` (join table, role `SCHEDULED | EXECUTED`) with cascades
- New enums: `BudgetStatus` (`DRAFT | APPROVED | PARTIAL | COMPLETED | CANCELLED`), `BudgetItemStatus`, `BudgetItemAppointmentRole`
- Migration `20260421154211_add_budget_models`

**RBAC:**
- New permissions `BUDGETS_VIEW / CREATE / UPDATE / DELETE / SHARE` (renamed `READ` → `VIEW` for codebase consistency)
- STAFF: view only. DOCTOR: view + create + update. CLINIC_ADMIN+: full access (`DELETE` and `SHARE` gated to CLINIC_ADMIN+)

**Service & routes:**
- `budget.service.ts` — `createBudget`, `getBudget`, `listBudgetsByPatient`, `updateBudget`, `deleteBudget` (soft), `addBudgetItem`, `updateBudgetItem`, `deleteBudgetItem`
- `totalAmount` auto-recalculated on every item change
- `Budget.status` auto-transitions between `APPROVED` / `PARTIAL` / `COMPLETED` based on item state; `DRAFT` and `CANCELLED` are sticky (user-controlled). A **manual status change still gets normalized** against item state — the auto-derived statuses are not directly user-settable.
- All mutations in a single transaction with recalculation
- Cross-tenant isolation enforced at the service layer
- Routes: `/api/budgets/:id` (GET, PATCH, DELETE), `/api/budgets/:id/items` (POST) and `/:itemId` (PATCH, DELETE), nested `/api/patients/:id/budgets` (GET list, POST create)
- Inline Zod schemas shared between top-level and nested endpoints
- 35 integration tests: validation, auth, cross-tenant isolation, totals recalculation, status transitions and all error branches

---

### Odontogram fixes: primary-teeth quadrants + per-patient toggle persistence — 2026-04-20
**PR:** [#171](https://github.com/Miguelslo27/dental-saas/pull/171)

#### Part 1: Primary-teeth quadrants (FDI)
Primary teeth were being stored and displayed with permanent-teeth quadrants (1–4) instead of the correct FDI notation (5–8). Root cause: the `react-odontogram` overlay instance with `maxTeeth={5}` reports FDI without differentiating permanent/primary.

- `remapPrimaryFdi` helper in `apps/app/src/pages/patients/odontogram-utils.ts` converts 1→5, 2→6, 3→7, 4→8 before persisting
- Dedicated `handlePrimaryOdontogramChange` handler and tooltip for primary chart
- CSS state-coloring rules scoped to `.odontogram-primary`
- Unit test for the helper

#### Part 2: Persistence of the "Show primary teeth" toggle
Toggle was stored in React local state and reset on every reload — useless for clinicians seeing the same patient multiple times.

- Prisma migration `20260420155523_add_show_primary_teeth_to_patient` adds `showPrimaryTeeth` column to `Patient`
- `createPatient()` defaults to `true` if patient age < 12, `false` otherwise
- Dedicated `PATCH /patients/:id/show-primary-teeth` endpoint (`updatePatientShowPrimaryTeeth()` service)
- Zod schema on the route
- 8 backend tests (enable/disable, 400, 404, 401, age-based defaults)
- `updateShowPrimaryTeeth()` in `patient-api` + 3 tests
- `PatientDetailPage` initializes from DB; optimistic toggle with `Loader2` spinner and inline error rollback
- i18n keys ES/EN/AR (`patients.showPrimaryTeethError`)

**Known follow-ups (not in PR):**
- Existing records saved with keys 11–45 are not auto-migrated. Decision deferred on whether to re-map historically or allow manual re-edit.
- Pre-existing patients default to `showPrimaryTeeth = false` (no age-based backfill). One click resolves it per patient.

---

### Doctor Detail Page — 2026-04-16
**PR:** [#170](https://github.com/Miguelslo27/dental-saas/pull/170)

- `DoctorDetailPage` with header, contact info, schedule, bio, and edit modal
- `DoctorAppointmentsSection` mirroring the `PatientAppointmentsSection` pattern (shows patient name, filters, actions)
- Route `/doctors/:id` registered in `App.tsx`
- "Ver detalle" link on `DoctorCard`
- Edit appointment modal integrated with conflict error handling

---

### Hotfix: Appointment conflict error handling — 2026-04-10
**PR:** [#169](https://github.com/Miguelslo27/dental-saas/pull/169)

Appointment conflict errors were swallowed and never surfaced to the user on create/edit.

- Backend verified: `excludeAppointmentId` works correctly on update (no self-conflict bug)
- Added backend tests: edit appointment without time change, edit to free time slot
- Error banner displayed inside the modal (above form, below header)
- `PatientDetailPage` uses `getAppointmentApiErrorMessage()` instead of raw axios message
- `AppointmentsPage` passes store error to modal and clears on open/close
- Error messages use i18n keys with `getUserLanguage()` fallback to `'es'` (workaround for `LanguageDetector` defaulting to browser language)
- i18n error keys added to ES/EN/AR (`appointments.errors.*`)

**Finding carried to ROADMAP:** `i18next-browser-languagedetector` detects the browser language instead of the app preference. Root fix tracked in `ROADMAP.md` under Medium Priority → Language & Regional Settings.

---

### E2E Testing suite (Playwright) — 2026-04-10
**PR:** [#168](https://github.com/Miguelslo27/dental-saas/pull/168)

46/46 end-to-end tests covering all major flows. Run with `cd apps/app && npx playwright test e2e/phase*.spec.ts`.

| Phase | File | Tests |
|-------|------|-------|
| 1. Auth & navigation | `phase1-auth-navigation.spec.ts` | 7/7 |
| 2. Patients (CRUD) | `phase2-patients.spec.ts` | 7/7 |
| 3. Doctors | `phase3-doctors.spec.ts` | 5/5 |
| 4. Appointments | `phase4-appointments.spec.ts` | 6/6 |
| 5. Labworks | `phase5-labworks.spec.ts` | 5/5 |
| 6. Expenses | `phase6-expenses.spec.ts` | 5/5 |
| 7–9. Dashboard, settings & cross-module | `phase7-9-dashboard-settings-crossmodule.spec.ts` | 10/10 |

**Findings:**
- Registration redirects directly to the dashboard (no `/register/success` step)
- i18n uses the browser language — headless Chromium defaults to English, so all selectors are bilingual (ES/EN)
- Login is occasionally flaky (~1/5 runs) due to API timing — resolved with retry

---

## 2026-03

### Epic: Link labwork to appointment with price-included option — 2026-03-09
**PRs:** [#166](https://github.com/Miguelslo27/dental-saas/pull/166), [#167](https://github.com/Miguelslo27/dental-saas/pull/167)

**Problem:** When a consultation and a labwork were created, both were added separately to the patient's debt even when the labwork price was already included in the consultation price — causing double-charging.

**Solution:** Allow linking a labwork to an existing appointment for the same patient. If `priceIncludedInAppointment` is set, the labwork price does not contribute to the debt.

**Data model (PR #166):**
- `Labwork.appointmentId` (nullable FK to `Appointment`)
- `Labwork.priceIncludedInAppointment` (boolean, default `false`)
- Relation `Appointment.labworks → Labwork[]`
- Reversible migration verified against existing data

**Backend (PR #166):**
- `getPatientBalance()` excludes labworks with `priceIncludedInAppointment === true` from `totalDebt`
- `recalculatePaidStatus()` excludes those labworks from the FIFO pool and auto-marks them `isPaid = true`
- `labwork.service.ts` validates that `appointmentId` belongs to the same patient/tenant and that `priceIncludedInAppointment` can only be `true` when `appointmentId` is present
- Zod schemas updated; unit + integration tests for balance, FIFO, and routes

**Frontend (PR #167):**
- Appointment selector in `LabworkFormModal`, appearing after patient selection
- "Precio incluido en la consulta" checkbox with informational note
- Pre-selection of linked appointment when editing
- "Incluido en consulta" badge on `LabworkCard`
- i18n: ES/EN/AR keys added

**Bugfix bundled in PR #167:** axios interceptor was redirecting to "session expired" instead of surfacing credential errors on login.

---

## 2026-02

### Production hardening: Gateway timeout fix — 2026-02-20
**PR:** [#152](https://github.com/Miguelslo27/dental-saas/pull/152)

Intermittent gateway timeouts after deploys. Root cause: Traefik was picking a random Docker network when routing to the API container.

- Added `traefik.docker.network` label to pin the correct network
- Deployed and verified: timeouts resolved in production
- Background docs: `docs/GATEWAY-TIMEOUT-FIX.md`

---

### Patient payment tracking (Entregas) — 2026-02-14 to 2026-02-18
**PRs:** [#137](https://github.com/Miguelslo27/dental-saas/pull/137) (model), [#138](https://github.com/Miguelslo27/dental-saas/pull/138) (API), [#140](https://github.com/Miguelslo27/dental-saas/pull/140) (frontend)

**Goal:** Let admin/doctor record patient payments toward outstanding debt, with automatic FIFO allocation to mark completed works as Paid.

**How it works:**
1. A patient accumulates debt from completed treatments/labworks (each with a cost)
2. Admin or doctor registers a payment (entrega) for any amount, up to the total debt
3. Payments cannot exceed the outstanding balance
4. Each payment is stored in a payment history (historial de entregas)
5. Payments are allocated FIFO (oldest work first): once cumulative payments cover a work's cost, that work is automatically marked as Paid

**Delivered:**
- `PatientPayment` model and payment permissions (PR #137)
- `payment.service.ts` with FIFO allocation (`getPatientBalance`, `recalculatePaidStatus`, `createPayment`, `deletePayment`, `listPayments`) and routes (PR #138)
- Frontend UI for registering and listing payments (PR #140)
- Auto-create payment when appointment marked as paid ([#155](https://github.com/Miguelslo27/dental-saas/pull/155))

**Remaining work** (tracked in `ROADMAP.md` → Backlog → Clinic & Billing): visual indicator on each work showing paid/unpaid status.

---
