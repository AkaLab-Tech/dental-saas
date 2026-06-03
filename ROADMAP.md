# Roadmap - Alveo System

## High Priority

### Labwork Improvements
- [ ] Save laboratory name when creating a labwork (autocomplete from previously used labs, or create new)
- [ ] Add labwork list/section to patient detail page

### Production Hardening
- [ ] Harden API startup: eager Prisma init, DB-verified health check, graceful shutdown, connection timeout — see [docs/GATEWAY-TIMEOUT-FIX.md](docs/GATEWAY-TIMEOUT-FIX.md)

### Bugs

#### Dashboard stats `401` race on a fresh login

On a freshly authenticated session (right after register or login), `DashboardPage` fires its `/api/stats/*` requests (`overview`, `revenue`, `patients-growth`, `appointments`) before the access token is attached to the API client, so the first render logs four `401 Unauthorized` errors in the console and the cards briefly show empty/zero data. The dashboard recovers on the next render/navigation, so it is cosmetic — but it pollutes the console and is a poor first impression. Observed end-to-end with the Playwright MCP on 2026-06-03; pre-existing, unrelated to the i18n work.

- [ ] Gate the stats requests on the auth-ready state (token attached) before firing, or retry once after the token is set
- [ ] Verify a fresh login shows no `401`s in the console and the cards populate on first paint

> **Resolved:** "Patient payment edits do not persist / payments stay stuck" — this was the original report behind [#179](https://github.com/Miguelslo27/dental-saas/pull/179) (FIFO paid flow). Reproduced end-to-end with the Playwright MCP and **verified fixed on production** on 2026-06-03 (see HISTORY). No further action.

> **Resolved (2026-06-03):** two i18n bugs — (1) the appointment-card `⋮` menu rendered the raw key `common.options` (the key was missing in all locales; added to es / en / ar), and (2) the sidebar nav labels in `AppLayout.tsx` were hardcoded Spanish instead of using the existing `nav.*` keys (now wired through `t()`). The earlier "mixed ES/EN on the patient detail page" report was a mis-diagnosis: those section components already use `t()` with complete `es` / `ar` translations — they render English only when the active language resolves to `en`, which is the language-detection issue tracked under **Medium Priority → Language & Regional Settings** ("Fix `i18next-browser-languagedetector` priority"), not a hardcoded-string bug.

### UX Improvements

#### Spike: Patient & Doctor list view alternatives

Both the patient list and the doctor list currently use a card-based layout. Explore alternative presentations to improve the user experience on both screens.

**Scope:** Patients list page and Doctors list page only.

**Deliverables:**
- [ ] Three list/view alternatives, each with a UX-driven rationale explaining why it is among the best options
- [ ] Comparative analysis of the three alternatives (pros, cons, fit for the data shown on each screen, accessibility, mobile/RTL behavior)
- [ ] Mockups and visual references for each alternative
- [ ] POC implementation of all three alternatives so a full hands-on comparison is possible
- [ ] Final recommendation: which option to adopt and whether it applies to one screen or both

**Acceptance:** the user can interact with all three POCs side by side and pick the one to ship as the follow-up implementation task.

#### Implement new list view for Patients and Doctors

Follow-up to the spike above. Once the spike picks a winning option, implement it on the Patients and Doctors list pages.

**Blocked by:** Spike: Patient & Doctor list view alternatives

- [ ] Replace the card layout on the Patients list page with the chosen alternative
- [ ] Replace the card layout on the Doctors list page with the chosen alternative
- [ ] Remove dead code from the previous card layout

#### Patient detail page redesign

Today the patient detail page stacks several blocks vertically (patient info, appointments, budgets, payments, images) with the odontogram as the main section. As more information lives on this page, the layout becomes hard to navigate. Reorganize it so the odontogram is always visible and the rest of the information moves into tabs.

The three sub-tasks below should be done in sequence: tabs first, then the new odontogram layout, then the visual polish that takes advantage of the wider available space.

##### 1. Reorganize patient detail into tabs

- [ ] Convert the existing blocks into tabs: `Patient` | `Appointments` | `Budgets` | `Payments` | `Images`
- [ ] The odontogram stays always visible, outside the tab system

##### 2. New odontogram layout (1 / 3 / 1 columns)

- [ ] Left column: legend / condition keys
- [ ] Center column: odontogram itself
- [ ] Right column: registered teeth list

##### 3. Visual polish per tab

- [ ] Redistribute the content inside each tab to take advantage of the wider available space
- [ ] Apply the polish to all five tabs: `Patient`, `Appointments`, `Budgets`, `Payments`, `Images`

## Medium Priority

### Language & Regional Settings
- [x] Fix `i18next-browser-languagedetector` priority: app preference (localStorage) should override browser language for non-React code (utility functions, stores) — detection order keeps `localStorage` ahead of `navigator`, added `supportedLngs` + `load: 'languageOnly'`, and `appointment-api`'s `getUserLanguage()` now reads `i18n.resolvedLanguage` instead of `localStorage` directly (2026-06-03)
- [x] Language selector in the registration form — added the existing `LanguageSelector` (buttons variant) to `RegisterPage`; the choice is cached to `localStorage` and becomes the saved preference (2026-06-03)
- [ ] Language selector in the web landing page (`apps/web`)
- [ ] Save language preference on registration
- [ ] Allow language change in settings (post-registration)
- [ ] Detect and use browser's default language
- [ ] Default timezone based on user's location
- [ ] Country dropdown for phone number area code

#### Portuguese (PT-BR) Language Support

**Context:** The settings schemas already accept `'pt'` as a valid language value (`apps/api/src/routes/settings.ts`, `apps/app/src/lib/settings-api.ts`), but the translation file does not exist and `pt` is not registered in `apps/app/src/i18n/index.ts`. This is leftover preparation that needs to be completed.

**Frontend:**
- [ ] Create `apps/app/src/i18n/locales/pt.json` (full translation of `es.json` to Portuguese — Brazilian variant)
- [ ] Register `pt` in `apps/app/src/i18n/index.ts` (`resources` object and `languages` array with native name "Português")
- [ ] Add "Português (Brasil)" option to the language selector in the settings page
- [ ] Add `pt` to `LanguageCode` type and update any consumers

**Backend:**
- [ ] Add PT translations to email templates (`apps/api/src/emails/`) — welcome email, password reset, etc.
- [ ] Add PT translations to PDF templates (`apps/api/src/pdfs/`) — invoices, treatment plans, budgets (once shipped)
- [ ] Ensure `getUserLanguage()` / backend i18n helpers handle `pt` fallback correctly

**Tests:**
- [ ] Add `pt` coverage to `apps/app/src/i18n/i18n.test.ts`
- [ ] Smoke test: render at least one page in `pt` and verify no missing keys

### UX Improvements
- [ ] Superadmin tables: allow clicking on clinic/user name to view details (not just ••• menu)
- [ ] Improve date/time picker UI (investigate user-friendly packages, replace browser defaults)
- [ ] Phone placeholder based on user's location

## Backlog

### Clinic & Billing
- [ ] Dashboard: add "Entregas recibidas este mes" stat card showing sum of patient payments received in the current month (separate from monthly revenue which only counts fully-paid items)
- [ ] Doctor commission: doctors earn a percentage per consultation/labwork
- [ ] Patient debt screen: dedicated view to see outstanding patient balances
- [ ] Configurable appointment duration (different lengths per appointment type)
- [ ] Visual indicator on each work showing paid/unpaid status (patient payment tracking — backend and basic frontend already shipped)

### Labworks
- [ ] Add doctor name to labwork records
- [ ] Add labwork status tracking (e.g. sent, in progress, received)

### Features
- [ ] Clinic user profiles & PIN system — see plan below
- [ ] Onboarding flow for new tenants
- [ ] DoctorPicker component (searchable combobox)

#### Plan: Clinic User Profiles & PIN System

**Goal:** Allow OWNER/ADMIN to create user profiles for clinic staff, with 4-digit PIN authentication for quick switching on shared devices (kiosk mode).

**How it works:**
1. OWNER logs in with email/password (existing flow, unchanged)
2. OWNER/ADMIN creates profiles from a dedicated "Users" management page, assigning roles (STAFF, DOCTOR, CLINIC_ADMIN, ADMIN)
3. Each user sets a 4-digit PIN on first access (mandatory, cannot be empty)
4. After X minutes of inactivity (configurable, default 5 min), the app auto-locks and shows the profile selector screen
5. User selects their profile → enters PIN → backend verifies PIN and issues a **new JWT** with that user's role and permissions
6. The app now operates with the selected user's permissions
7. Profile creation is NOT available from the lock screen — only from the admin section

**Backend tasks:**
- [ ] Add `pinHash` field to User model (nullable — null means PIN not yet set)
- [ ] Add `autoLockMinutes` to TenantSettings (default: 5, 0 = disabled)
- [ ] `PUT /api/auth/pin` — set/update PIN for the current user (requires current PIN if already set)
- [ ] `POST /api/auth/verify-pin` — verify PIN for a given userId, returns new JWT (access + refresh tokens) for that user
- [ ] `GET /api/users/profiles` — list all active users for the profile selector (id, firstName, lastName, avatar, role, hasPinSet) — no auth required beyond tenant context
- [ ] User management endpoints: already exist (`POST /api/users`, `PUT /api/users/:id`, etc.) — verify completeness

**Frontend tasks:**
- [ ] **User management page** (`/users`) — OWNER/ADMIN only: list users, create, edit role, deactivate
- [ ] **Create/edit user form** — firstName, lastName, email, password, role selector
- [ ] **PIN setup screen** — shown when `hasPinSet = false` after selecting profile or on first login; 4-digit input + confirmation
- [ ] **Auto-lock idle timer** — detects mouse/keyboard/touch inactivity, locks app after configured timeout
- [ ] **Profile selector screen** — grid of user cards (avatar, name, role); shown on auto-lock
- [ ] **PIN entry screen** — 4-digit PIN input shown after selecting a profile; on success, switches JWT and redirects to dashboard
- [ ] **Auto-lock setting** — add timeout config to settings page (OWNER/ADMIN only)
- [ ] **Nav item** — add "Users" to sidebar navigation (visible to OWNER/ADMIN)
- [ ] i18n keys for ES/EN/AR
- [ ] FullCalendar integration (using custom view for now)
- [ ] Weekly calendar view
- [ ] Prescriptions component
- [ ] og-image.png (1200x630px) for apps/web/public/
- [ ] Subscriptions and payments (dLocal integration)

### Security & Performance
- [ ] Rate limiting with Redis (persistence and scalability)
- [ ] Rate limiting for password recovery (3 attempts per IP in 15 min)

### Technical
- [ ] E2E tests for admin panel
- [ ] Audit logging for superadmin actions
- [ ] Pagination in admin endpoints
- [ ] 2FA for super admin
- [ ] Dark mode toggle
- [ ] Dashboard with real-time metrics (WebSocket)
- [ ] Soft delete for tenants
- [ ] Export tenant data before deletion

---

## SaaS Business Model

### Subscription Plans

| Feature | Free | Basic ($U 399/mes) | Enterprise ($U 699/mes) |
|---------|------|-------|------------|
| **Price** | $U 0/mes | $U 399/mes | $U 699/mes |
| **Administrators** | 1 | 2 | 5 |
| **Doctors** | 3 | 5 | 10 |
| **Patients** | 50 | 200 | 500 |
| **Storage** | 100MB | 1GB | 5GB |
| **Support** | Community | Email | Priority |
| **Backups** | Manual | Daily | Daily + Export |

### Future: Pricing & Plans
- [ ] 4th plan or add-on packages for clinics needing more patients, doctors, or storage beyond Enterprise limits
- [ ] Internationalization of prices by country (currency conversion, inflation adjustments per region)

---

## Future Epics (Large-Scale Initiatives)

### Epic: Desktop Application (Windows / Mac / Linux)
**Goal:** Native desktop app with offline-first capabilities

**Key Features:**
- [ ] Cross-platform desktop app (Electron or Tauri)
- [ ] UI/UX similar to web application
- [ ] Offline-first architecture with local database (SQLite)
- [ ] Automatic sync when online (conflict resolution strategy)
- [ ] Background sync service
- [ ] Offline indicators and sync status
- [ ] Local data encryption
- [ ] Auto-updates mechanism

**Technical Considerations:**
- Sync engine design (operational transformation or CRDT)
- Conflict resolution for appointments, patient records, etc.
- Local storage limits and cleanup strategy
- Migration path from web-only to hybrid usage

---

### Epic: Mobile Applications (iOS / Android)
**Goal:** Two mobile apps - one for clinic staff, one for patients

---

#### App 1: DentalClinic Pro (Admin & Doctors) - Multi-role

**Target Users:** Clinic administrators and doctors

**Shared Features (All Roles):**
- [ ] Login with role detection (Admin/Doctor)
- [ ] Multi-language support (ES/EN/AR)
- [ ] Push notifications
- [ ] Offline reading + sync queue
- [ ] Biometric authentication

**Admin Features:**
- [ ] View/manage all clinic appointments (daily/weekly agenda)
- [ ] Patient check-in functionality
- [ ] Create/edit/cancel appointments
- [ ] Search patients and view basic info
- [ ] Register payments on-the-spot
- [ ] View and register daily expenses
- [ ] View pending labworks
- [ ] Quick access to patient contacts (call/WhatsApp)
- [ ] Send appointment reminders
- [ ] Dashboard: daily summary (appointments, income, expenses)

**Doctor Features:**
- [ ] View only ASSIGNED appointments (daily/weekly)
- [ ] Mark appointments as completed
- [ ] View complete patient file before/during consultation
- [ ] Dental chart viewer (read-only on mobile, edit on desktop)
- [ ] Complete treatment history
- [ ] View notes from previous appointments
- [ ] Access patient documents/PDFs
- [ ] Add quick notes post-consultation
- [ ] Register treatments performed (simplified UI)
- [ ] Mark labworks as sent/received

---

#### App 2: DentalClinic (Patients) - Separate App

**Target Users:** Patients (end users)

**Key Features:**
- [ ] View upcoming appointments
- [ ] Appointment history
- [ ] Medical/dental history viewer
- [ ] Treatment records and dental chart (read-only)
- [ ] Expenses and payment history
- [ ] Push notifications for appointment reminders
- [ ] Document viewer (PDFs, prescriptions, treatment plans)
- [ ] Profile management
- [ ] Multi-language support (ES/EN/AR)
- [ ] Request appointment (pending approval by clinic)

**Authentication:**
- [ ] Patient-specific auth flow (separate from clinic staff)
- [ ] Biometric authentication support
- [ ] Secure token storage

---

**Technical Stack Options:**
- React Native (leverage existing React knowledge)
- Flutter (native performance)
- Progressive Web App (PWA) as MVP

**Offline Strategy:**
- Clinic Staff App: More critical - read offline + queue changes for sync
- Patient App: Read-only offline for recent data

---

## Future Enhancement: Separate Table for Dental Chart (v2)

**When to migrate:** When treatment history, structured conditions, or aggregated reports are needed.

```prisma
model ToothRecord {
  id          String   @id @default(cuid())
  patientId   String
  toothNumber String   // ISO 3950 (FDI)
  condition   ToothCondition?
  notes       String?
  treatment   String?
  severity    Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String

  @@unique([patientId, toothNumber])
}

enum ToothCondition {
  HEALTHY, CARIES, FILLED, CROWN, EXTRACTION_NEEDED, MISSING, IMPLANT, ROOT_CANAL, BRIDGE
}
```
