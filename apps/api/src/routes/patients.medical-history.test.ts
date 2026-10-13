import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'

const MEDICAL_KEYS = ['allergies', 'currentMedication', 'conditions', 'previousSurgeries', 'medicalNotes'] as const

// Five DISTINCT, recognisable sections. If a handler maps two sections onto the
// same column, at least one of these round-trips to the wrong text.
const FULL_HISTORY = {
  allergies: [{ text: 'ALLERGY-ONE synthetic latex reaction', criticality: 'critical' }],
  currentMedication: [
    { text: 'MEDICATION-TWO synthetic daily tablet', criticality: 'normal' },
    { text: 'MEDICATION-TWO-B synthetic evening drops', criticality: 'critical' },
  ],
  conditions: [{ text: 'CONDITION-THREE synthetic hypertension', criticality: 'critical' }],
  previousSurgeries: [{ text: 'SURGERY-FOUR synthetic appendix removal', criticality: 'normal' }],
  medicalNotes: [{ text: 'NOTE-FIVE synthetic prefers morning visits', criticality: 'normal' }],
}

describe('Patient medical history API', () => {
  let tenantId: string
  let otherTenantId: string
  const userIds: string[] = []
  let adminToken: string
  let clinicAdminToken: string
  let ownerToken: string
  let doctorToken: string
  let staffToken: string
  let doctorId: string
  let clinicAdminId: string
  let staffId: string
  const slug = `test-clinic-medhist-${Date.now()}`

  async function makeUser(role: 'ADMIN' | 'CLINIC_ADMIN' | 'OWNER' | 'DOCTOR' | 'STAFF', tId: string, tag: string) {
    const user = await prisma.user.create({
      data: {
        email: `${tag}-${slug}@test.com`,
        passwordHash: await hashPassword('SyntheticPass123!'),
        firstName: 'Synthetic',
        lastName: tag,
        role,
        tenantId: tId,
      },
    })
    userIds.push(user.id)
    return { id: user.id, token: generateToken(user.id, tId, role) }
  }

  async function makePatient(createdBy: string | null, extra: Record<string, unknown> = {}, tId = tenantId) {
    return prisma.patient.create({
      data: { tenantId: tId, firstName: 'Testpatient', lastName: 'Synthetic', createdBy, ...extra },
    })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Synthetic Clinic MedHist', slug } })
    tenantId = tenant.id
    const other = await prisma.tenant.create({ data: { name: 'Synthetic Other MedHist', slug: `${slug}-other` } })
    otherTenantId = other.id

    adminToken = (await makeUser('ADMIN', tenantId, 'admin')).token
    const clinicAdmin = await makeUser('CLINIC_ADMIN', tenantId, 'clinicadmin')
    clinicAdminToken = clinicAdmin.token
    clinicAdminId = clinicAdmin.id
    ownerToken = (await makeUser('OWNER', tenantId, 'owner')).token
    const doctor = await makeUser('DOCTOR', tenantId, 'doctor')
    doctorToken = doctor.token
    doctorId = doctor.id
    const staff = await makeUser('STAFF', tenantId, 'staff')
    staffToken = staff.token
    staffId = staff.id
  })

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  beforeEach(async () => {
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
  })

  describe('permission enforcement (guard 1)', () => {
    it('rejects STAFF on read with the permission error shape (not an ownership error)', async () => {
      const patient = await makePatient(null, { allergies: '[critical] SECRET-ALLERGY' })

      const res = await api()
        .get(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'medical_history:view' })
      expect(JSON.stringify(res.body)).not.toContain('SECRET-ALLERGY')
    })

    it('rejects STAFF on write with the permission error shape and leaves the row untouched', async () => {
      // createdBy = the staff user's own id would pass ownership; the 403 must be the permission one.
      const staffUser = await prisma.user.findFirstOrThrow({ where: { tenantId, role: 'STAFF' } })
      const patient = await makePatient(staffUser.id)

      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ allergies: [{ text: 'blocked', criticality: 'normal' }] })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'medical_history:update' })
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBeNull()
    })

    it('rejects an unauthenticated request with 401 on both verbs', async () => {
      const patient = await makePatient(null)
      const get = await api().get(`/api/patients/${patient.id}/medical-history`)
      const put = await api().put(`/api/patients/${patient.id}/medical-history`).send({})
      expect(get.status).toBe(401)
      expect(put.status).toBe(401)
    })

    it.each([
      ['DOCTOR', () => doctorToken],
      ['CLINIC_ADMIN', () => clinicAdminToken],
      ['ADMIN', () => adminToken],
      ['OWNER', () => ownerToken],
    ])('allows %s to read', async (_role, token) => {
      const patient = await makePatient(null)
      const res = await api()
        .get(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${token()}`)
      expect(res.status).toBe(200)
    })

    it.each([
      ['CLINIC_ADMIN', () => clinicAdminToken],
      ['ADMIN', () => adminToken],
      ['OWNER', () => ownerToken],
    ])('allows %s to write a patient they did not create (ownership bypass)', async (_role, token) => {
      const patient = await makePatient(doctorId)
      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${token()}`)
        .send({ allergies: [{ text: 'x', criticality: 'normal' }] })
      expect(res.status).toBe(200)
    })

    // These two replace a pair of ownership tests that asserted the opposite.
    // The route is no longer ownership-scoped, so what must stop an unauthorised
    // write is the PERMISSION, not who opened the record. The first of these
    // previously built a state the API cannot produce: `makePatient(doctorId)`
    // writes `createdBy` straight through Prisma, while POST /patients requires
    // CLINIC_ADMIN (hierarchy 3) and DOCTOR is 2 — so no API-created patient can
    // carry a doctor's `createdBy`, and that green test certified a row that does
    // not exist in production.
    it('lets a DOCTOR write medical history on a patient somebody else opened', async () => {
      const patient = await makePatient(clinicAdminId)
      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ allergies: [{ text: 'DOCTOR-WRITE synthetic penicillin', criticality: 'critical' }] })

      expect(res.status).toBe(200)
      // Assert the stored row, not the echo: a handler that returned 200 without
      // writing would pass on the status alone.
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBe('[critical] DOCTOR-WRITE synthetic penicillin')
    })

    it('still rejects a role without MEDICAL_HISTORY_UPDATE, whoever opened the record', async () => {
      // The surviving guard, and the one that must be seen to fail: with the
      // ownership check gone, only the permission stands between STAFF and a
      // clinical write. `createdBy` is the staff user's own id, so ownership
      // would have ALLOWED this — the 403 can only come from the permission.
      const patient = await makePatient(staffId)
      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ allergies: [{ text: 'x', criticality: 'normal' }] })

      expect(res.status).toBe(403)
      expect(res.body.required).toBe('medical_history:update')
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBeNull()
    })
  })

  describe('round trip of all five fields (guard 4)', () => {
    it('stores each section in its own column and returns each in its own key', async () => {
      const patient = await makePatient(null)

      const put = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(FULL_HISTORY)
      expect(put.status).toBe(200)
      expect(put.body.data).toEqual(FULL_HISTORY)

      // The stored rows, column by column: distinct text per column.
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBe('[critical] ALLERGY-ONE synthetic latex reaction')
      expect(row.currentMedication).toBe(
        '[normal] MEDICATION-TWO synthetic daily tablet\n[critical] MEDICATION-TWO-B synthetic evening drops'
      )
      expect(row.conditions).toBe('[critical] CONDITION-THREE synthetic hypertension')
      expect(row.previousSurgeries).toBe('[normal] SURGERY-FOUR synthetic appendix removal')
      expect(row.medicalNotes).toBe('[normal] NOTE-FIVE synthetic prefers morning visits')

      const get = await api()
        .get(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(get.status).toBe(200)
      expect(get.body.data).toEqual(FULL_HISTORY)
    })

    it('GET on a patient with no history returns five empty arrays', async () => {
      const patient = await makePatient(null)
      const res = await api()
        .get(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.body.data).toEqual({
        allergies: [],
        currentMedication: [],
        conditions: [],
        previousSurgeries: [],
        medicalNotes: [],
      })
    })

    it('a partial write replaces only the sections sent and leaves the others exactly as stored', async () => {
      const patient = await makePatient(null)
      await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(FULL_HISTORY)

      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conditions: [{ text: 'CONDITION-REPLACED', criticality: 'normal' }] })
      expect(res.status).toBe(200)

      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.conditions).toBe('[normal] CONDITION-REPLACED')
      expect(row.allergies).toBe('[critical] ALLERGY-ONE synthetic latex reaction')
      expect(row.medicalNotes).toBe('[normal] NOTE-FIVE synthetic prefers morning visits')
    })

    it('an empty array clears that section to null and only that section', async () => {
      const patient = await makePatient(null)
      await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(FULL_HISTORY)

      await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allergies: [] })

      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBeNull()
      expect(row.conditions).toBe('[critical] CONDITION-THREE synthetic hypertension')
    })

    it('a stored line with no criticality token reads back as normal, verbatim', async () => {
      const patient = await makePatient(null, { notes: 'unrelated', medicalNotes: 'legacy free text line' })
      const res = await api()
        .get(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.body.data.medicalNotes).toEqual([{ text: 'legacy free text line', criticality: 'normal' }])
    })
  })

  describe('address is untouched by a medical write (guard 2)', () => {
    it('leaves the stored address byte-identical after a full medical write', async () => {
      const patient = await makePatient(null, { address: '742 Synthetic Avenue, Testville' })

      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(FULL_HISTORY)
      expect(res.status).toBe(200)

      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.address).toBe('742 Synthetic Avenue, Testville')
      expect(row.allergies).not.toBeNull()
    })

    it('rejects a body carrying address with 400 and writes nothing', async () => {
      const patient = await makePatient(null, { address: '742 Synthetic Avenue, Testville' })

      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'overwritten', allergies: [{ text: 'x', criticality: 'normal' }] })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')

      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.address).toBe('742 Synthetic Avenue, Testville')
      expect(row.allergies).toBeNull()
    })
  })

  describe('validation (guard 3)', () => {
    it('rejects an unknown criticality with 400 VALIDATION_ERROR naming the field, and stores nothing', async () => {
      const patient = await makePatient(null)

      const res = await api()
        .put(`/api/patients/${patient.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allergies: [{ text: 'x', criticality: 'urgent' }] })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details).toHaveLength(1)
      expect(res.body.error.details[0].path).toEqual(['allergies', 0, 'criticality'])

      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBeNull()
    })

    it('rejects multi-line text, empty text and over-long text with 400', async () => {
      const patient = await makePatient(null)
      const bodies = [
        { allergies: [{ text: 'line one\nline two', criticality: 'normal' }] },
        { allergies: [{ text: '   ', criticality: 'normal' }] },
        { allergies: [{ text: 'a'.repeat(501), criticality: 'normal' }] },
      ]
      for (const body of bodies) {
        const res = await api()
          .put(`/api/patients/${patient.id}/medical-history`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(body)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      }
    })
  })

  describe('not found and tenant isolation', () => {
    it('returns 404 NOT_FOUND for a missing patient on both verbs', async () => {
      const id = '00000000-0000-4000-8000-000000000000'
      const get = await api().get(`/api/patients/${id}/medical-history`).set('Authorization', `Bearer ${adminToken}`)
      const put = await api()
        .put(`/api/patients/${id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(get.status).toBe(404)
      expect(get.body.error.code).toBe('NOT_FOUND')
      expect(put.status).toBe(404)
      expect(put.body.error.code).toBe('NOT_FOUND')
    })

    it("does not read or write another tenant's patient", async () => {
      const foreign = await makePatient(null, { allergies: '[critical] FOREIGN-SECRET' }, otherTenantId)

      const get = await api()
        .get(`/api/patients/${foreign.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
      const put = await api()
        .put(`/api/patients/${foreign.id}/medical-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allergies: [{ text: 'hijack', criticality: 'normal' }] })

      expect(get.status).toBe(404)
      expect(JSON.stringify(get.body)).not.toContain('FOREIGN-SECRET')
      expect(put.status).toBe(404)
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: foreign.id } })
      expect(row.allergies).toBe('[critical] FOREIGN-SECRET')
    })
  })

  describe('whole-row leak (guard 5)', () => {
    const fullRow = {
      allergies: '[critical] LEAK-A',
      currentMedication: '[normal] LEAK-B',
      conditions: '[normal] LEAK-C',
      previousSurgeries: '[normal] LEAK-D',
      medicalNotes: '[normal] LEAK-E',
    }

    it('GET /:id as STAFF contains none of the five medical keys or values', async () => {
      const patient = await makePatient(null, fullRow)
      const res = await api().get(`/api/patients/${patient.id}`).set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(patient.id)
      for (const key of MEDICAL_KEYS) expect(res.body.data).not.toHaveProperty(key)
      expect(JSON.stringify(res.body)).not.toMatch(/LEAK-[A-E]/)
    })

    it('GET / as STAFF contains none of the five medical keys or values, for a non-empty list', async () => {
      await makePatient(null, fullRow)
      const res = await api().get('/api/patients').set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      for (const key of MEDICAL_KEYS) expect(res.body.data[0]).not.toHaveProperty(key)
      expect(JSON.stringify(res.body)).not.toMatch(/LEAK-[A-E]/)
    })

    it('PUT /:id with medical keys in the body does not write them', async () => {
      const patient = await makePatient(null)
      await api()
        .put(`/api/patients/${patient.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Renamed', allergies: 'sneaked in' })
      const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
      expect(row.allergies).toBeNull()
    })
  })
})
