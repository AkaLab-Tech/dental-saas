# Plan — Budget Epic PR C, Story 3: PDF + public share link

> Status: draft for operator approval. ROADMAP uses High/Medium/Low layout (manual, not atelier §5).

## Key finding: two acceptance criteria are ALREADY implemented
- **AC #1 (polish, the "blocker")** — done. `apps/app/src/pages/budgets/BudgetDetailPage.tsx:45-52`
  defines `USER_SETTABLE_BUDGET_STATUSES = ['DRAFT','APPROVED','CANCELLED']`; dropdown (317-338)
  renders only those + a disabled option for the current derived status. Backend normalizes via
  `deriveBudgetStatus` at `apps/api/src/services/budget.service.ts:101-121`.
- **AC #4 (schema `publicToken`/`publicTokenExpiresAt`)** — done. `packages/database/prisma/schema.prisma:569-571`;
  migration `packages/database/prisma/migrations/20260421154211_add_budget_models/migration.sql`. **No new migration.**
- `Permission.BUDGETS_SHARE` already exists (`packages/shared/src/permissions.ts:82`, owner/admin/clinic-admin).

## Codebase anchors
- PDF service: `apps/api/src/services/pdf.service.ts` (`generatePdf` L106, `getTenantInfo` L126 → name/logo/contact/currency/language).
- Reference template (fully i18n'd): `apps/api/src/pdfs/AppointmentReceiptPdf.tsx`; barrel `index.ts`.
- PDF route pattern: `apps/api/src/routes/appointments.ts:442-469`.
- PDF service tests mock `@dental/database` (`vi.mock`), assert Buffer starts with `%PDF`: `pdf.service.test.ts`.
- i18n: `packages/shared/src/translations/` — `t(language,key,values)`, `Language='es'|'en'|'ar'`, keys nested `pdf.*` in `pdf-emails.{es,en,ar}.ts`.
- Budget service (functional exports): `apps/api/src/services/budget.service.ts`; routes `apps/api/src/routes/budgets.ts` mounted `/api/budgets`.
- Auth is per-mount middleware in `apps/api/src/app.ts:56` (`requireAuthWithTenant`); public routes just omit it (e.g. `/api/plans`).
- **No rate limiter dependency exists.**
- Token pattern to reuse: `apps/api/src/utils/password-reset.ts:13` (`crypto.randomBytes(32).toString('hex')` + expiry helper).
- apps/web: Vite React SPA, react-router@7 `BrowserRouter` in `apps/web/src/App.tsx`; pages `apps/web/src/pages/*.tsx`.
  **No API client, no `VITE_API_URL` yet** — first data-fetching page. Copy `apps/app/src/lib/api.ts:7`.
- App-panel PDF download helper: `apps/app/src/lib/pdf-api.ts` (`downloadPdf`); budget client `apps/app/src/lib/budget-api.ts`.
- Route test pattern: `apps/api/src/routes/budgets.test.ts` (supertest + real prisma + jwt `sign`).

## Steps
0. **Polish** — verify already done; add `BudgetDetailPage.test.tsx` coverage if missing. No backend change.
1. **Schema** — verify only; no migration.
2. **i18n** — add `pdf.budget.*` block to `pdf-emails.{en,es,ar}.ts`.
3. **PDF template + service** — `apps/api/src/pdfs/BudgetPdf.tsx` (+ barrel export); `getBudgetPdfData(tenantId,budgetId)` in `pdf.service.ts` (reuse `getBudget` + `getTenantInfo`).
4. **Token + endpoints** — share helper (reuse password-reset pattern); `generateShareToken`/`getBudgetByPublicToken` in budget.service; `GET /:id/pdf` (`BUDGETS_VIEW`) + `POST /:id/share` (`BUDGETS_SHARE`) in `budgets.ts`; new `public-budgets.ts` (no auth, rate-limited); mount `/api/public/budgets` in `app.ts`.
5. **Rate limiter** — decision: `express-rate-limit` via `/atelier:safe-install`, applied to public router only.
6. **App panel** — `downloadBudgetPdf` + `shareBudget` clients; Download/Share buttons in `BudgetDetailPage`.
7. **apps/web public page** — `VITE_API_URL` + `apps/web/src/lib/api.ts`; `PublicBudgetPage.tsx`; route `/budget/:token` in `App.tsx`.
8. **Tests** — pdf.service (budget cases), budgets.test (pdf + share), new public-budgets.test.

## Decisions (operator-approved 2026-07-03)
- **PR split:** TWO PRs. Start with **C-3a** (backend + app panel). C-3b (apps/web public page) after.
- **Rate limiter:** add `express-rate-limit` via `/atelier:safe-install`, public router only, ~30 req/min/IP.
- **Token expiry:** no expiry on rotate + optional `expiresInDays` param (schema `publicTokenExpiresAt` stays nullable).

## Remaining open decisions
- **Public data exposure:** confirm patient full name is acceptable on an unauthenticated (secret-token) link; never leak `tenantId`/internal fields.
- **CORS:** `app.ts:27` uses single `CORS_ORIGIN`; web origin must be allowed for `/api/public/*`.
- **Arabic PDF:** may need `Font.register` for RTL glyphs (existing templates untested for `ar`).
