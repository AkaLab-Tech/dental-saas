import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

/**
 * Integration tests for requireOwnership(): DOCTOR/STAFF may only mutate
 * records they created (or, for appointments/labworks, are assigned to);
 * CLINIC_ADMIN and above bypass the check.
 */
describe('requireOwnership middleware', () => {
  let tenantId: string
  let doctorAToken: string
  let doctorBToken: string
  let clinicAdminToken: string
  let ownedPatientId: string
  let assignedApptId: string
  const testSlug = `test-clinic-ownership-${Date.now()}`

  function token(userId: string, role: string) {
    // Production access tokens carry `userId` (see TokenPayload), which the
    // ownership middleware reads — not `sub`.
    return sign({ userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Ownership Clinic', slug: testSlug } })
    tenantId = tenant.id
    const passwordHash = await hashPassword('TestPass123!')

    const doctorUserA = await prisma.user.create({
      data: { email: 'doc-a-own@test.com', passwordHash, firstName: 'Doc', lastName: 'A', role: 'DOCTOR', tenantId },
    })
    const doctorUserB = await prisma.user.create({
      data: { email: 'doc-b-own@test.com', passwordHash, firstName: 'Doc', lastName: 'B', role: 'DOCTOR', tenantId },
    })
    const clinicAdmin = await prisma.user.create({
      data: { email: 'ca-own@test.com', passwordHash, firstName: 'Clinic', lastName: 'Admin', role: 'CLINIC_ADMIN', tenantId },
    })
    doctorAToken = token(doctorUserA.id, 'DOCTOR')
    doctorBToken = token(doctorUserB.id, 'DOCTOR')
    clinicAdminToken = token(clinicAdmin.id, 'CLINIC_ADMIN')

    const doctorA = await prisma.doctor.create({
      data: { firstName: 'Dr', lastName: 'A', email: 'dr-a-own@test.com', tenantId, userId: doctorUserA.id },
    })

    // Patient created BY doctor A → owned by doctor A.
    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Owned', lastName: 'Patient', createdBy: doctorUserA.id },
    })
    ownedPatientId = patient.id

    // Appointment created by the clinic admin but ASSIGNED to doctor A.
    const appt = await prisma.appointment.create({
      data: {
        tenantId,
        patientId: patient.id,
        doctorId: doctorA.id,
        startTime: new Date(Date.now() + 86_400_000),
        endTime: new Date(Date.now() + 90_000_000),
        duration: 30,
        createdBy: clinicAdmin.id,
      },
    })
    assignedApptId = appt.id
  })

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  it('lets a doctor edit a patient they created', async () => {
    const res = await api()
      .put(`/api/patients/${ownedPatientId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .send({ firstName: 'OwnedUpdated' })
    expect(res.status).toBe(200)
    expect(res.body.data.firstName).toBe('OwnedUpdated')
  })

  it('forbids a doctor from editing a patient another doctor created (403)', async () => {
    const res = await api()
      .put(`/api/patients/${ownedPatientId}`)
      .set('Authorization', `Bearer ${doctorBToken}`)
      .send({ firstName: 'Hijacked' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OWNERSHIP_REQUIRED')
  })

  it('lets a CLINIC_ADMIN edit any patient (ownership bypass)', async () => {
    const res = await api()
      .put(`/api/patients/${ownedPatientId}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ firstName: 'AdminEdited' })
    expect(res.status).toBe(200)
  })

  it('lets a doctor edit an appointment they are assigned to even if they did not create it', async () => {
    const res = await api()
      .put(`/api/appointments/${assignedApptId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .send({ notes: 'Seen by assigned doctor' })
    expect(res.status).toBe(200)
  })

  it('forbids an unrelated doctor from editing that appointment (403)', async () => {
    const res = await api()
      .put(`/api/appointments/${assignedApptId}`)
      .set('Authorization', `Bearer ${doctorBToken}`)
      .send({ notes: 'Should be blocked' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OWNERSHIP_REQUIRED')
  })
})
