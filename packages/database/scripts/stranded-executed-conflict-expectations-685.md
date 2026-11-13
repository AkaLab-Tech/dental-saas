# #685 part 2 — expectations, to be posted to the issue BEFORE anything is applied

Post the section below verbatim as a comment on
https://github.com/AkaLab-Tech/dental-saas/issues/685, before the production
dry-run is applied and before the clinic touches a single record. It states what
the run is expected to print and what each falsifier stops. Ids and figures
only: no patient name appears here, and none may be added.

The production run is
`packages/database/scripts/stranded-executed-conflict-dryrun.sh`, piped into
psql by the operator (production is SSH-only; this chain never reaches it).

---

## #685 part 2 — what the dry-run must print, and what stops the apply

**Route being signed off** (per record, in this order, all existing UI):
1. soft-delete the empty re-creation, 2. restore the original, 3. clear the
typed `Costo`, 4. mark done. Order is load-bearing: an inactive appointment's
menu offers only «Restaurar», so the cost cannot be cleared before the restore.

### Expected rows

- **7 stranded items** — 6 `blocked: TIME_CONFLICT` across 5 appointments plus
  the 1 the part-1 runbook already covers. `(R)`'s `inactive link: uncharged`
  count, `(N3)`'s row count and `(N3t).items` must all read **7**.
- Part 1's controls must still hold: `(C)` `draft_live` **48** and
  `matched_open_lines` **0**; `(R)` **22** `factura` / **19** `tapado por #590`
  / **7** `inactive link`; `(Rc)` `all_buckets` = `draft_live`, `exec_links` =
  `items`, `scheduled_links` **41** (= 48 − 7); `(K)` **89** patients /
  **523,647.50**.

### Expected money

- **End state: 86,500 moves into billed debt** — 77,000 from this part's 6
  items plus 9,500 from the item part 1 already covers — **minus the price of
  every record the product lead decides to leave with its typed cost**. If, for
  example, one 5,000 record keeps its cost, the expectation is 81,500, not
  86,500, and the difference is a decision, not a loss of money.
- **Intermediate figure, named so it is not read as a regression:** between
  step 2 (restore) and step 3 (clear `Costo`) the restored visits bill their own
  typed costs — up to **28,800** across the five records that carry one
  (15,000 / 5,000 / 5,000 / 2,300 / 1,500) — while the items still read 0. The
  window is transient and reversible; the four steps are done back to back on
  one record before the next is started. The **86,500 is the end state**, not a
  figure to look for mid-way.
- A `DRAFT` budget is excluded from `remainingBudgetProjection` as well, so for
  this population the recovery is a move from **nowhere** into billed debt, not
  a transfer out of the projection. Statement totals after the apply must be
  read with that in mind.

### Falsifiers — each stops the apply rather than being worked around

| Section | Falsifier |
| --- | --- |
| `(C)` / `(R)` / `(Rc)` / `(K)` | Any control off its expected value: the population moved since 2026-11-13 and nothing below it can be trusted. |
| `(N1)` replacement emptiness | Any non-zero payment / labwork / link count, any non-empty note, or a typed cost on a blocker: it is **not** empty, soft-deleting it loses data, and that record leaves the batch and returns to the product lead. |
| `(N2)` identity | A pair failing `same_patient` or `same_start_minute` is not a re-creation of the same visit; the "same visit" premise does not hold and it must not be batched. |
| `(N3)` money | Typed costs other than 15,000 / 5,000 / 5,000 / 2,300 / 1,500 (28,800 total), or an item-price total other than 86,500 over 7 rows: the population moved. |
| `(N4)` conflict recheck | `blockers_remaining > 0`: step 1 does not unblock that restore and the record is not recoverable by this route. |
| `(N5)` pattern width | ~5 pairs means this batch is the whole problem and prevention stays half 2 of #685. Materially larger means the figure is carried into the half-2 issue **as its scope** — this part is not widened either way. |
| `(N3h)` held | A patient whose `held` equals that patient's uncharged item price is the shape risk 5 of the plan names; it is a coincidence until measured, and a match is reported to the product lead before the restore, because restoring converts an earmarked advance back to `kind: 'APPOINTMENT'`. |

### What the apply is, and whose hands it is in

- The psql dry-run: the **operator's** (production is reachable only over SSH).
- The four UI steps per record: the **clinic assistant's**, `CLINIC_ADMIN`
  minimum, and only from the signed list.
- `G7` (clearing the cost on an already-paid record, `CANNOT_UNMARK_PAID`) was
  **not built**: the plan gates it on the production dry-run showing a paid
  record, and that condition cannot be evaluated from the implementation chain.
  It is deferred for lack of an evaluated condition, not judged unnecessary. If
  `(N3)` prints `appt_is_paid = t` for any of the five, the guard is owed before
  step 3 is attempted on that record.

---
