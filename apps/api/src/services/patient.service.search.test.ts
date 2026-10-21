import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { listPatients } from './patient.service.js'

// #601: typing a given name AND a family name returned nothing, because the whole
// typed string was compared against each column separately; and the comparison was
// accent-sensitive ('Pérez' ILIKE '%Perez%' is false).
//
// GUARD NUMBERING follows the approved plan for #601 and is referenced by number in
// the PR body. Guards 1-6, 8 and 9 live here; guard 7 (doctors) lives in
// doctor.service.search.test.ts.
//
// The fixture varies each axis independently, so no guard can pass by coincidence:
//   - Quintela: two-token name, NO accent, email and phone NULL (so a two-word match
//     cannot come from a concatenated contact column, and `NULL ILIKE ...` is NULL and
//     must not select the row);
//   - Tormes: accent in the given name only, plain ASCII family name, so the two
//     directions of accent-insensitivity are separable on one row;
//   - Obregon: accents AND a two-token name, the realistic combination;
//   - Weller: the only row with email and phone populated;
//   - Sharedname: one per tenant, for the tenant-isolation guard.
// No fixture value contains the string 'zzzz' or 'qqqqzzzz', which is what makes the
// exclusion guard (4) and the vacuity guard (8) meaningful.
describe('listPatients search (#601)', () => {
  const suffix = Date.now()
  let tenantA: string
  let tenantB: string

  const names = async (tenantId: string, search: string) =>
    (await listPatients(tenantId, { limit: 100, search })).map((p) => `${p.firstName} ${p.lastName}`).sort()

  beforeAll(async () => {
    const a = await prisma.tenant.create({ data: { name: 'Search A 601', slug: `search-a-601-${suffix}` } })
    const b = await prisma.tenant.create({ data: { name: 'Search B 601', slug: `search-b-601-${suffix}` } })
    tenantA = a.id
    tenantB = b.id

    await prisma.patient.createMany({
      data: [
        // two tokens, no accent, no contact data
        { tenantId: tenantA, firstName: 'Marisol', lastName: 'Quintela' },
        // accented given name, unaccented family name
        { tenantId: tenantA, firstName: 'Ánxela', lastName: 'Tormes' },
        // accents and two tokens together
        { tenantId: tenantA, firstName: 'Félix', lastName: 'Obregón' },
        // the only row with email and phone
        {
          tenantId: tenantA,
          firstName: 'Tobias',
          lastName: 'Weller',
          email: 'tobias.weller@example.test',
          phone: '099123456',
        },
        // tenant-isolation pair: same family name in both tenants
        { tenantId: tenantA, firstName: 'Alfa', lastName: 'Sharedname' },
        { tenantId: tenantB, firstName: 'Beta', lastName: 'Sharedname' },
      ],
    })
  })

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  })

  // GUARD 1 — the reported defect: two tokens living in two different columns.
  it('guard 1: a given name and a family name together find the patient', async () => {
    expect(await names(tenantA, 'Marisol Quintela')).toEqual(['Marisol Quintela'])
  })

  // GUARD 2 — separate it() from guard 1 on purpose: in one block the second
  // assertion would be unreachable whenever the first fails.
  it('guard 2: the reverse word order finds the same patient', async () => {
    expect(await names(tenantA, 'Quintela Marisol')).toEqual(['Marisol Quintela'])
  })

  // GUARD 3 — the behaviour that already worked and must not regress.
  it('guard 3: the given name alone still finds the patient', async () => {
    expect(await names(tenantA, 'Marisol')).toEqual(['Marisol Quintela'])
  })

  it('guard 3: the family name alone still finds the patient', async () => {
    expect(await names(tenantA, 'Quintela')).toEqual(['Marisol Quintela'])
  })

  // GUARD 4 — discriminates AND-over-tokens from OR-over-tokens. A naive OR passes
  // guards 1-3 while making the search strictly worse.
  it('guard 4: a token matching nothing excludes the row', async () => {
    expect(await names(tenantA, 'Marisol zzzz')).toEqual([])
  })

  // GUARD 5 — both directions, in separate blocks: a one-sided normalisation passes
  // one and fails the other.
  it('guard 5: an unaccented query finds an accented record', async () => {
    expect(await names(tenantA, 'Anxela')).toEqual(['Ánxela Tormes'])
  })

  it('guard 5: an accented query finds an unaccented record', async () => {
    expect(await names(tenantA, 'Tórmes')).toEqual(['Ánxela Tormes'])
  })

  it('guard 5: an unaccented two-word query finds a fully accented record', async () => {
    expect(await names(tenantA, 'Felix Obregon')).toEqual(['Félix Obregón'])
  })

  // GUARD 6 — the fix must not have narrowed the searchable columns.
  it('guard 6: a phone fragment still finds its row', async () => {
    expect(await names(tenantA, '9912345')).toEqual(['Tobias Weller'])
  })

  it('guard 6: an email fragment still finds its row', async () => {
    expect(await names(tenantA, 'weller@example.test')).toEqual(['Tobias Weller'])
  })

  it('guard 6: a token in the name and a token in the email match one row', async () => {
    expect(await names(tenantA, 'Tobias example.test')).toEqual(['Tobias Weller'])
  })

  // GUARD 8 — vacuity: without it, an implementation that drops the filter entirely
  // passes every guard above.
  it('guard 8: a query matching no column of any row returns nothing', async () => {
    expect(await names(tenantA, 'qqqqzzzz')).toEqual([])
  })

  // GUARD 9 — the raw-SQL trap: raw SQL bypasses Prisma's tenant extension, so the
  // tenantId predicate is written by hand and has to stay.
  it("guard 9: tenant A's search returns its own patient, not tenant B's", async () => {
    expect(await names(tenantA, 'Sharedname')).toEqual(['Alfa Sharedname'])
  })

  it("guard 9: tenant B's search returns its own patient, not tenant A's", async () => {
    expect(await names(tenantB, 'Sharedname')).toEqual(['Beta Sharedname'])
  })
})
