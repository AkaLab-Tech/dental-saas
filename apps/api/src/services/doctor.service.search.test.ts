import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { listDoctors } from './doctor.service.js'

// #601 GUARD 7: doctors get the same treatment as patients, asserted here rather
// than inherited by assumption — listDoctors has its own copy of the tokenised,
// accent-insensitive raw query, over a different column set (firstName, lastName,
// email, specialty), so `specialty` gets its own assertions.
//
// Guard numbering follows the approved plan for #601: everything in this file is
// guard 7, except the two closing cases, which are the guard 9 (tenant isolation)
// twin for the doctor copy of the raw query. The fixture varies the axes
// independently, exactly as the patient fixture does: Castaldi is two-token and
// unaccented with no contact data, Tormes carries the accent on one side only, and
// Obregon combines accents with two tokens. No value contains 'zzzz'.
describe('listDoctors search (#601 guard 7)', () => {
  const suffix = Date.now()
  let tenantA: string
  let tenantB: string

  const names = async (tenantId: string, search: string) =>
    (await listDoctors(tenantId, { limit: 100, search })).map((d) => `${d.firstName} ${d.lastName}`).sort()

  beforeAll(async () => {
    const a = await prisma.tenant.create({ data: { name: 'Doc Search A 601', slug: `doc-search-a-601-${suffix}` } })
    const b = await prisma.tenant.create({ data: { name: 'Doc Search B 601', slug: `doc-search-b-601-${suffix}` } })
    tenantA = a.id
    tenantB = b.id

    await prisma.doctor.createMany({
      data: [
        // two tokens, no accent, specialty populated, email and phone NULL
        { tenantId: tenantA, firstName: 'Ruben', lastName: 'Castaldi', specialty: 'Ortodoncia' },
        // accented given name, unaccented family name, no specialty
        { tenantId: tenantA, firstName: 'Álvaro', lastName: 'Tormes' },
        // accents and two tokens, plus email and an accented specialty
        {
          tenantId: tenantA,
          firstName: 'Félix',
          lastName: 'Obregón',
          email: 'felix.obregon@example.test',
          specialty: 'Periodoncía',
        },
        // tenant-isolation pair
        { tenantId: tenantA, firstName: 'Alfa', lastName: 'Sharedoc' },
        { tenantId: tenantB, firstName: 'Beta', lastName: 'Sharedoc' },
      ],
    })
  })

  afterAll(async () => {
    await prisma.doctor.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  })

  it('guard 7: a given name and a family name together find the doctor', async () => {
    expect(await names(tenantA, 'Ruben Castaldi')).toEqual(['Ruben Castaldi'])
  })

  it('guard 7: the reverse word order finds the same doctor', async () => {
    expect(await names(tenantA, 'Castaldi Ruben')).toEqual(['Ruben Castaldi'])
  })

  it('guard 7: the family name alone still finds the doctor', async () => {
    expect(await names(tenantA, 'Castaldi')).toEqual(['Ruben Castaldi'])
  })

  it('guard 7: a token matching nothing excludes the row', async () => {
    expect(await names(tenantA, 'Castaldi zzzz')).toEqual([])
  })

  it('guard 7: an unaccented query finds an accented doctor record', async () => {
    expect(await names(tenantA, 'Alvaro')).toEqual(['Álvaro Tormes'])
  })

  it('guard 7: an accented query finds an unaccented doctor record', async () => {
    expect(await names(tenantA, 'Tórmes')).toEqual(['Álvaro Tormes'])
  })

  it('guard 7: a specialty fragment still finds its doctor', async () => {
    expect(await names(tenantA, 'Ortodoncia')).toEqual(['Ruben Castaldi'])
  })

  it('guard 7: an accent-insensitive specialty fragment finds its doctor', async () => {
    expect(await names(tenantA, 'Periodoncia')).toEqual(['Félix Obregón'])
  })

  it('guard 7: a name token and a specialty token match one doctor', async () => {
    expect(await names(tenantA, 'Castaldi Ortodoncia')).toEqual(['Ruben Castaldi'])
  })

  it('guard 7: an email fragment still finds its doctor', async () => {
    expect(await names(tenantA, 'obregon@example.test')).toEqual(['Félix Obregón'])
  })

  it('guard 7: a query matching no column of any doctor returns nothing (vacuity)', async () => {
    expect(await names(tenantA, 'qqqqzzzz')).toEqual([])
  })

  // The guard 9 twin for the doctor copy of the raw query: it binds tenantId by hand
  // because raw SQL bypasses Prisma's tenant extension.
  it("guard 9 (doctors): tenant A's search returns its own doctor, not tenant B's", async () => {
    expect(await names(tenantA, 'Sharedoc')).toEqual(['Alfa Sharedoc'])
  })

  it("guard 9 (doctors): tenant B's search returns its own doctor, not tenant A's", async () => {
    expect(await names(tenantB, 'Sharedoc')).toEqual(['Beta Sharedoc'])
  })
})
