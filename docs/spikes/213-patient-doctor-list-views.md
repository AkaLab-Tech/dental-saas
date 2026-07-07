# Spike #213 — Patient & Doctor list view alternatives

Status: **complete**. Timeboxed research spike (~1 day). No production behavior
changed as part of this task — see "How to view the POCs" below for the exact
throwaway code paths and how to reach them.

## Why this spike exists

`PatientsPage` and `DoctorsPage` both render a responsive card grid
(`PatientCard` / `DoctorCard`) with no pagination — the store fetches the
full list and filters client-side. That works for small clinics but:

- Cards are low density: 3 cards per row on a large screen shows far fewer
  records per screen than the table-based pages already in the app
  (`AdminUsersPage`, `UsersPage`, `AdminTenantsPage`, `DashboardPage`).
- There is no sort.
- The existing in-house table pattern is well established (4 pages already
  use it), so a table alternative would not be inventing a new UI language
  for the product.

This spike builds low-fidelity, throwaway POCs of three alternatives side by
side and recommends one.

## How to view the POCs live

The POCs are gated behind a `?view=` query flag on the **existing**
`PatientsPage` / `DoctorsPage` routes — nothing new was added to the router.

| URL | Renders |
|---|---|
| `/patients` or `/patients?view=cards` | **Unchanged production behavior** — `PatientCard` grid |
| `/patients?view=table` | POC 1 — dense sortable table |
| `/patients?view=hybrid` | POC 3 — responsive hybrid (table ≥ lg, compact list-rows < lg) |
| `/doctors` or `/doctors?view=cards` | **Unchanged production behavior** — `DoctorCard` grid |
| `/doctors?view=table` | POC 1 — dense sortable table |
| `/doctors?view=hybrid` | POC 3 — responsive hybrid |

The default render (no `?view=` param) was verified to be byte-for-byte the
same production code path — the existing `PatientsPage.test.tsx` /
`DoctorsPage.test.tsx` suites (58 tests) pass unmodified, and a manual
Playwright pass against a freshly-registered test tenant confirmed the
default screenshot matches current prod.

POC source (clearly marked, throwaway, not for production — do not ship
as-is):

- `apps/app/src/pages/patients/spike/PatientsTableView.tsx`
- `apps/app/src/pages/patients/spike/PatientsHybridView.tsx`
- `apps/app/src/pages/doctors/spike/DoctorsTableView.tsx`
- `apps/app/src/pages/doctors/spike/DoctorsHybridView.tsx`

Each file's header comment says "SPIKE POC for #213 — throwaway code, not
for production."

## The three alternatives

### 1. Dense sortable table

One row per patient/doctor, sortable columns (name, gender/age or
specialty, date of birth), inline actions on the right (`View record` /
`Edit` / `Delete`, or `Restore` for inactive rows).

**UX rationale:** matches the density and interaction model users already
get on `/users`, `/admin/users`, `/admin/tenants` and the dashboard — no new
UI language. Column sort answers a real need ("find the youngest patient",
"find doctors by specialty") that the card grid cannot do at all today.
Scans fastest for staff processing many records back-to-back (reception,
billing).

**Pros:**
- Highest information density — far more rows visible per screen than
  3-per-row cards.
- Column sort, for free, on any field.
- Reuses an established in-house visual pattern 1:1 (same header/row/hover
  classes as `AdminUsersPage`).
- Inline actions are one click away, no card padding/whitespace tax.

**Cons:**
- Loses the avatar-forward, "at a glance" feel of the card (a clinic front
  desk scanning for a face/name combo may prefer the card's larger avatar
  and looser layout).
- A flat table degrades on narrow viewports (horizontal scroll) — this POC
  keeps it usable down to `md` by hiding the contact column, but below
  `sm` it still needs horizontal scroll. This is why alternative 3 exists.
- Column real estate is finite — the doctor table already drops "Working
  hours" (shown on the card) to fit; a table always trades off completeness
  for density.

**Fit with existing components:** direct reuse of the existing table
markup/classes (`bg-white rounded-xl border ... <table>`), `ConfirmDialog`
for delete (unchanged, wired through the same `onDelete` handler the page
already passes to the card), same navigation target for `View record`
(`/patients/:id`, `/doctors/:id`). `PatientSearchCombobox` is unrelated to
this list (it is used inside forms elsewhere, e.g. attaching a patient to an
appointment) and needs no changes either way.

**Accessibility:** column headers are `<button>` elements with
`aria-sort="ascending" | "descending" | "none"`, so a screen reader
announces the current sort state; native tab order flows header → row →
row (no ARIA grid pattern needed since there's no 2D arrow-key navigation).
Icons are decorative only (labels carry the meaning); actions keep their
existing `Pencil` / `Trash2` / `RotateCcw` icon + text combination so
nothing is icon-only.

**Mobile / RTL:** verified at 1400px and manually confirmed the header/row
mirrors correctly under `dir="rtl"` (Arabic) — column order, icon
placement and text alignment all flip as expected, no layout breakage.
Below `lg` the table requires horizontal scroll (acceptable for a spike,
not recommended to ship as the sole option on mobile — see alternative 3).

### 2. Card grid, refined (not built as a full POC — see note)

The plan called for evaluating whether the *existing* card grid should be
kept but tightened (denser padding, a compact/comfortable toggle). Given the
timebox, this spike did not build a separate "refined cards" POC file
distinct from the current `?view=cards` baseline — the baseline **is** the
input for this evaluation, and the assessment is captured here rather than
in new throwaway code, since a density toggle is a parametric tweak to the
existing `PatientCard`/`DoctorCard`, not a structurally different layout.

**UX rationale:** best when clinics have few patients/doctors (the common
case per the "no pagination" note below) and staff value the larger touch
targets, one action row per card, and immediate visual scanning by avatar +
name. It is also the only option of the three that reads well without any
tabular affordances (no header row, no alignment grid) — friendliest for a
first-time or less technical user.

**Pros:**
- Already shipped, already tested, zero migration risk.
- Best "at a glance" identification (large avatar, loose spacing) for
  small lists.
- Naturally responsive already (`sm:grid-cols-2 lg:grid-cols-3`).

**Cons:**
- Lowest density of the three — the worst fit once a clinic has 50+
  patients, which is explicitly the growth case #214 needs to plan for.
- No sort at all.
- A "compact vs comfortable" toggle adds UI-state complexity (where does
  the preference persist — per user? per tenant? localStorage?) for a
  gain that a table already provides for free via density alone.

**Fit with existing components:** no changes — it *is* the existing
component.

**Accessibility:** unchanged from today (each card's action row is already
keyboard-reachable; `Ver ficha` link icon has a visible label).

**Mobile / RTL:** unchanged from today — already used in production across
locales including Arabic.

### 3. Hybrid / responsive switch

A single component renders a dense table at `lg:` and up, and reflows to
compact list-row cards (name, one-line meta, contact, actions) below `lg`
— no separate mobile route, one component, one set of handlers.

**UX rationale:** gets the desktop density win of the table without
sacrificing the mobile card experience users are used to. This is the
option that best matches how the rest of the app already behaves — e.g.
`UsersPage`'s table already hides the email and status columns below `md`
rather than switching to a different component; this POC takes that one
step further and swaps the whole layout, since a truncated table row is a
much worse mobile experience than a purpose-built compact row.

**Pros:**
- One component, one source of truth for the row data mapping — no drift
  between a "table version" and a "mobile version" of the same entity (the
  POC shares a single `ActionButtons` sub-component and a single sort hook
  between both renders).
- Best of both: dense/sortable on desktop, thumb-friendly on mobile.
- Directly reuses the same Tailwind breakpoint (`lg`) the sidebar/nav
  already collapses at, so it lines up with the rest of the app's existing
  responsive rhythm instead of introducing a new breakpoint.

**Cons:**
- Two markup trees (desktop table + mobile list) live in the same file —
  more JSX than either alternative alone, though the data/sort logic is
  shared. A future production implementation should extract a shared
  `<ListRow>` presentational piece if this is the direction chosen, to
  avoid the two trees drifting apart.
- Sort only applies to the desktop table read model in this POC; the
  mobile list re-orders too (it consumes the same sorted array) but has no
  interactive sort UI of its own (thumb-sized column headers do not fit) —
  worth deciding at implementation time whether mobile needs its own
  "sort by" affordance (e.g. a `<select>`) or whether inheriting the last
  desktop sort is good enough.

**Fit with existing components:** same table markup reuse as alternative 1
for the desktop branch; the mobile branch is a new compact card shape (not
`PatientCard`/`DoctorCard` — deliberately lighter, no dedicated status
badge unless inactive) — this is a legitimate new small component if
shipped, not a reuse of the existing card.

**Accessibility:** same `aria-sort` treatment as alternative 1 for the
desktop table. The mobile list is a sequence of `<div>` "rows" rather than
a table — each one is reachable by tab order via its action buttons/links;
no roving-tabindex grid needed since there is no 2D navigation.

**Mobile / RTL:** this is the option actually exercised at a real mobile
viewport (390×844) in this spike, and it looked correct — see screenshots
section. Not re-verified in Arabic at mobile width in this pass (RTL was
checked against the table view at desktop width); given the mobile branch
uses only flex/space-y utilities (no explicit left/right positioning), RTL
risk here is low but should get an explicit pass in #214 if this direction
is chosen.

## Comparative summary

| | Density | Sort | Mobile fit | New component surface | Best for |
|---|---|---|---|---|---|
| 1. Table | High | Yes | Poor (h-scroll) | Low (existing pattern) | Desktop-first, larger clinics |
| 2. Cards (current) | Low | No | Good | None (already shipped) | Small clinics, first-run UX |
| 3. Hybrid | High (desktop) / Good (mobile) | Yes (desktop) | Good | Medium (one new mobile row shape) | Growing clinics across device mix |

## Pagination / virtualization note (input to #214)

Today both `patients.store.ts` and `doctors.store.ts` fetch the *entire*
list client-side and filter/search in-memory — there is no `limit`/`offset`
paging in the UI, even though `ListPatientsParams` / `ListDoctorsParams`
already support `limit`/`offset` at the API layer (only `PatientSearchCombobox`
uses `limit: 10` today, for its typeahead).

- **Cards (current) and dense table** do not materially change the paging
  math — a table just renders the same in-memory array more densely. The
  risk is DOM size once list length grows into the hundreds: a plain
  `<table>` with hundreds of `<tr>` has no virtualization and will start
  to feel slow to scroll well before the card grid would (cards are
  larger individually but there are 1/3 as many per row, so total DOM
  node count is roughly comparable order-of-magnitude either way).
- **Recommendation:** ship the chosen option *without* virtualization
  initially (none of the three POCs needed it up to the handful of test
  records used here), but treat server-side pagination as the very next
  increment once real clinic data volumes are known — **this is squarely
  #214's scope**, not this spike's. Concretely, #214 should decide whether
  to add `limit`/`offset` (or cursor) paging to `fetchPatients`/`fetchDoctors`
  and a pager control, sized to the chosen list-view option. A dense table
  makes this more urgent (it invites scanning larger lists) than the card
  grid did, so if the table or hybrid option ships, #214 should treat
  pagination as in-scope rather than a "someday" follow-up.

## Final recommendation

**Ship the hybrid option (alternative 3) for both Patients and Doctors.**

Rationale: the card grid's mobile experience is worth preserving (this is a
touch-first, front-desk workflow much of the time), but the desktop card
grid is the clinic's biggest data-density complaint waiting to happen as
patient/doctor lists grow — and the in-house table pattern already proves
staff are comfortable with dense tables elsewhere in the app (`/users`,
`/admin/users`). The hybrid gets both without asking the product to pick
one experience over the other, and it is a single component to maintain
going forward rather than two divergent ones.

Apply it to **both** screens — Patients and Doctors have near-identical
data shapes (name + one categorical field + contact + a small enumerable
attribute set) and the same action row, so there is no UX reason to diverge
between them.

Sequencing for #214:
1. Implement the hybrid layout as the real, permanent `PatientsPage` /
   `DoctorsPage` rendering (retiring the card-only baseline; the `?view=`
   flag and the `spike/` throwaway files from this task should be deleted,
   not merged forward).
2. Decide and implement the pagination/virtualization follow-up described
   above as part of the same or an immediately-following task, since a
   denser default view is what makes that follow-up urgent.
3. Give the mobile branch of the hybrid a "sort by" affordance if product
   feedback shows users want to sort on mobile too (not required for v1).

**These POC components are throwaway — do not ship as-is.** `#214`
implements the chosen option (hybrid) properly: as a shared, tested,
production component (not `apps/app/src/pages/*/spike/*`), with its own
unit tests, i18n keys promoted out of this spike's ad-hoc additions if
naming changes, and the pagination decision from the section above folded
in.

## Screenshots

Full-page Playwright screenshots were captured against a freshly-registered
throwaway test tenant (`spike-213`) running the API against a local Postgres,
covering: default cards (Patients, Doctors — confirmed unchanged), table view
(Patients with an inactive/restorable row, Doctors), hybrid view at desktop
width (1400px) and mobile width (390px) for both entities, and the table view
under Arabic/RTL. All rendered correctly (sort indicators, action buttons,
inactive/restore affordance, RTL mirroring). Per this environment's
constraints, these screenshots were used for interactive verification during
implementation but are not uploaded/attached to this document — reproduce
them live via the URLs in "How to view the POCs live" above.
