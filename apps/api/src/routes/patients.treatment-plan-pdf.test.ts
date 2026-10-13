/**
 * #541 — GET /api/patients/:id/budgets/pdf, the whole treatment plan as one
 * document. Integration tests through the real route stack (auth,
 * requirePermission, service, renderer).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sign } from 'jsonwebtoken'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import { pdfText, pdfTextFlat, pdfPageCount } from '../test/pdf-text.js'

/** The clinic's shape from #541: nine DRAFT budgets of one item, 22.500 total. */
const PLAN = [
  { description: 'Extraccion (36, 38)', amount: 4000 },
  { description: 'Dyp 2da', amount: 1500 },
  { description: 'Dyp 1era', amount: 1500 },
  { description: 'CO (18)', amount: 2500 },
  { description: 'CP (22)', amount: 2500 },
  { description: 'CV (37)', amount: 2500 },
  { description: 'Extraccion (26, 27)', amount: 4000 },
  { description: 'Extraccion (44, 48)', amount: 2500 },
  { description: 'Consulta y plan', amount: 1500 },
]

describe('GET /api/patients/:id/budgets/pdf (#541)', () => {
  let tenantId: string
  let otherTenantId: string
  let adminUserId: string
  let staffUserId: string
  let adminToken: string
  let staffToken: string
  /**
   * A role whose permission set does not contain BUDGETS_VIEW. Every tenant
   * role (STAFF upwards) carries it, so SUPER_ADMIN — whose ROLE_PERMISSIONS
   * entry is empty, because it uses the /admin routes — is the only way to
   * observe the gate from the outside. requirePermission reads `user.role` and
   * nothing else, so this is a faithful exercise of the middleware.
   */
  let noBudgetsViewToken: string
  let patientId: string
  let otherTenantPatientId: string
  const slug = `test-clinic-plan-route-${Date.now()}`

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Plan Route', slug, currency: 'UYU' },
    })
    tenantId = tenant.id
    const other = await prisma.tenant.create({
      data: { name: 'Other Clinic Plan Route', slug: `${slug}-other` },
    })
    otherTenantId = other.id

    const passwordHash = await hashPassword('AdminPass123!')
    const admin = await prisma.user.create({
      data: {
        email: `admin-${slug}@test.com`,
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    adminUserId = admin.id
    adminToken = generateToken(admin.id, tenantId, 'ADMIN')

    const staff = await prisma.user.create({
      data: {
        email: `staff-${slug}@test.com`,
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId,
      },
    })
    staffUserId = staff.id
    staffToken = generateToken(staff.id, tenantId, 'STAFF')
    noBudgetsViewToken = sign(
      { userId: admin.id, tenantId, role: 'SUPER_ADMIN' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    )

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Nueve', lastName: 'Presupuestos' },
    })
    patientId = patient.id
    const foreign = await prisma.patient.create({
      data: { tenantId: otherTenantId, firstName: 'Ajeno', lastName: 'Inquilino' },
    })
    otherTenantPatientId = foreign.id

    for (const item of PLAN) {
      await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          status: 'DRAFT',
          totalAmount: item.amount,
          items: {
            create: [
              {
                description: item.description,
                quantity: 1,
                unitPrice: item.amount,
                totalPrice: item.amount,
              },
            ],
          },
        },
      })
    }
  })

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminUserId, staffUserId] } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  it('returns one attachment PDF with every treatment and the 22500 total', async () => {
    const res = await api()
      .get(`/api/patients/${patientId}/budgets/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe(
      // sanitizeFilename lower-cases, as it does for the other PDF routes
      `attachment; filename="treatment-plan-nueve-presupuestos-${patientId}.pdf"`
    )
    const body = res.body as Buffer
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(body.toString('utf8', 0, 5)).toBe('%PDF-')
    expect(pdfPageCount(body)).toBe(1)

    const text = pdfTextFlat(body)
    for (const { description } of PLAN) {
      expect(text, `"${description}" missing from the downloaded plan`).toContain(description)
    }
    expect(text).toContain('UYU 22500')
  })

  it('allows STAFF, whose only budget permission is BUDGETS_VIEW', async () => {
    const res = await api()
      .get(`/api/patients/${patientId}/budgets/pdf`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
  })

  it('returns 403 and names budgets:view for a role without that permission', async () => {
    const res = await api()
      .get(`/api/patients/${patientId}/budgets/pdf`)
      .set('Authorization', `Bearer ${noBudgetsViewToken}`)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'budgets:view' })
  })

  it('returns 401 without a token', async () => {
    const res = await api().get(`/api/patients/${patientId}/budgets/pdf`)
    expect(res.status).toBe(401)
  })

  it("returns 404 for another tenant's patient id and renders no PDF", async () => {
    const res = await api()
      .get(`/api/patients/${otherTenantPatientId}/budgets/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 for an unknown patient id', async () => {
    const res = await api()
      .get('/api/patients/no-such-patient/budgets/pdf')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  it('does not shadow GET /:id/budgets, which still returns the JSON list', async () => {
    // Express 5 matches in declaration order, so a sloppier path (or declaring
    // the PDF route first with a loose segment) could swallow the list route.
    const res = await api()
      .get(`/api/patients/${patientId}/budgets`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveLength(PLAN.length)
  })

  it('serves a plan with no items as a one-page document rather than failing', async () => {
    const empty = await prisma.patient.create({
      data: { tenantId, firstName: 'Sin', lastName: 'Presupuestos' },
    })
    const res = await api()
      .get(`/api/patients/${empty.id}/budgets/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as Buffer
    expect(pdfPageCount(body)).toBe(1)
    expect(pdfText(body)).toContain('Este paciente no tiene tratamientos presupuestados.')

    await prisma.patient.delete({ where: { id: empty.id } })
  })
})
