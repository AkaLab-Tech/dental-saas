import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { listPatients } from './patient.service.js'

// #566 GUARD 5: paging shows every patient exactly once, in the displayed order.
//
// The list is ordered by family name, then given name, and the client no longer
// re-sorts, so the page boundaries are the only thing that can lose or repeat a
// patient. The fixture is chosen so that:
//   - the order by family name differs from the order by given name (Zoe Alba is
//     first by family name but last by given name), so an ordering by the wrong
//     column cannot produce the expected sequence;
//   - two patients share a family name (Mora) and straddle the limit-2 page
//     boundary, so the given-name tie-breaker decides who ends page 1;
//   - rows are inserted out of order, so insertion order proves nothing.
describe('listPatients paging order (#566)', () => {
  let tenantId: string
  const suffix = Date.now()

  const label = (p: { firstName: string; lastName: string }) => `${p.lastName}, ${p.firstName}`

  const EXPECTED = ['Alba, Zoe', 'Mora, Ana', 'Mora, Bruno', 'Nunez, Carla', 'Zapata, Dario']

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Order Svc 566', slug: `order-svc-566-${suffix}` } })
    tenantId = tenant.id
    // Deliberately not in any name order.
    for (const [firstName, lastName] of [
      ['Dario', 'Zapata'],
      ['Bruno', 'Mora'],
      ['Zoe', 'Alba'],
      ['Carla', 'Nunez'],
      ['Ana', 'Mora'],
    ]) {
      await prisma.patient.create({ data: { tenantId, firstName, lastName } })
    }
  })

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  async function pagesOf(limit: number) {
    const pages: string[][] = []
    // Bounded, like the route-layer twin in routes/patients.test.ts. One of the
    // regressions these cases exist to catch is `offset` no longer being applied; in
    // that state listPatients returns the same non-empty page forever and an unbounded
    // loop never terminates, so the failure arrives as a vitest timeout instead of the
    // page diff. The bound is derived from the fixture, so it grows with it: one
    // full page past the last row.
    for (let offset = 0; offset < EXPECTED.length + limit; offset += limit) {
      const rows = await listPatients(tenantId, { limit, offset })
      if (rows.length === 0) break
      pages.push(rows.map(label))
    }
    return pages
  }

  it('the fixture orders differently by family name than by given name (vacuity check)', () => {
    const given = ['Ana', 'Bruno', 'Carla', 'Dario', 'Zoe']
    const familyFirstNames = EXPECTED.map((e) => e.split(', ')[1])
    expect(familyFirstNames).not.toEqual(given)
  })

  it('limit 2: the pages are exactly the ordered list, each patient once', async () => {
    const pages = await pagesOf(2)
    expect(pages).toEqual([['Alba, Zoe', 'Mora, Ana'], ['Mora, Bruno', 'Nunez, Carla'], ['Zapata, Dario']])
    expect(pages.flat()).toEqual(EXPECTED)
  })

  it('limit 3: the pages are exactly the ordered list, each patient once', async () => {
    const pages = await pagesOf(3)
    expect(pages).toEqual([['Alba, Zoe', 'Mora, Ana', 'Mora, Bruno'], ['Nunez, Carla', 'Zapata, Dario']])
    expect(pages.flat()).toEqual(EXPECTED)
  })

  it('the concatenated pages equal the unpaged list', async () => {
    const all = (await listPatients(tenantId, { limit: 100 })).map(label)
    expect(all).toEqual(EXPECTED)
    expect((await pagesOf(2)).flat()).toEqual(all)
  })
})
