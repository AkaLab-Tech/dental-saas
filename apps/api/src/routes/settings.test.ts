import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import jwt from 'jsonwebtoken'
import { prisma } from '@dental/database'
import { api } from '../test/http.js'

describe('Settings Routes', () => {
  let tenantId: string
  let planId: string
  let ownerToken: string
  let staffToken: string
  let ownerId: string
  let staffId: string

  function generateToken(payload: {
    userId: string
    tenantId: string
    email: string
    role: string
  }) {
    return jwt.sign(payload, process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-here')
  }

  beforeAll(async () => {
    // Create plan
    const plan = await prisma.plan.upsert({
      where: { name: 'enterprise' },
      update: {},
      create: {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: 0,
        maxAdmins: 5,
        maxDoctors: 10,
        maxPatients: 60,
        features: [],
      },
    })
    planId = plan.id

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Settings Test Clinic',
        slug: `settings-routes-test-${Date.now()}`,
        subscription: {
          create: {
            planId,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date('2099-12-31'),
          },
        },
      },
    })
    tenantId = tenant.id

    // Create owner user
    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: `owner-settings-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        firstName: 'Owner',
        lastName: 'User',
        role: 'OWNER',
      },
    })
    ownerId = owner.id
    ownerToken = generateToken({
      userId: ownerId,
      tenantId,
      email: owner.email,
      role: 'OWNER',
    })

    // Create staff user
    const staff = await prisma.user.create({
      data: {
        tenantId,
        email: `staff-settings-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
      },
    })
    staffId = staff.id
    staffToken = generateToken({
      userId: staffId,
      tenantId,
      email: staff.email,
      role: 'STAFF',
    })
  })

  afterAll(async () => {
    await prisma.tenantSettings.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('GET /api/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await api().get('/api/settings')

      expect(res.status).toBe(401)
    })

    it('should return default settings for new tenant', async () => {
      const res = await api()
        .get('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.settings).toBeDefined()
      expect(res.body.settings.language).toBe('es')
      expect(res.body.settings.dateFormat).toBe('DD/MM/YYYY')
      expect(res.body.settings.timeFormat).toBe('24h')
      expect(res.body.settings.defaultAppointmentDuration).toBe(30)
      expect(res.body.settings.emailNotifications).toBe(true)
      expect(res.body.settings.workingDays).toEqual([1, 2, 3, 4, 5])
      // Task #239: TenantSettings.appointmentTypeDurations defaults to the
      // empty array (Prisma column default `Json @default("[]")`) for a
      // tenant that has never set it.
      expect(res.body.settings.appointmentTypeDurations).toEqual([])
    })

    it('should allow staff to read settings', async () => {
      const res = await api()
        .get('/api/settings')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.settings).toBeDefined()
    })
  })

  describe('PUT /api/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await api()
        .put('/api/settings')
        .send({ language: 'en' })

      expect(res.status).toBe(401)
    })

    it('should return 403 for staff trying to update', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ language: 'en' })

      expect(res.status).toBe(403)
    })

    it('should update language setting', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ language: 'en' })

      expect(res.status).toBe(200)
      expect(res.body.settings.language).toBe('en')
    })

    // Task #221: the enum used to be ['es', 'en', 'pt'] — 'pt' was never a
    // real supported language, and 'ar' (which is) was rejected. These two
    // cases are the exact inverse of that bug and would have failed against
    // the old enum.
    it('should accept "ar" as a valid language', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ language: 'ar' })

      expect(res.status).toBe(200)
      expect(res.body.settings.language).toBe('ar')
    })

    it('should reject "pt" as an unsupported language', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ language: 'pt' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation Error')
    })

    it('should update multiple settings', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          dateFormat: 'MM/DD/YYYY',
          timeFormat: '12h',
          defaultAppointmentDuration: 45,
        })

      expect(res.status).toBe(200)
      expect(res.body.settings.dateFormat).toBe('MM/DD/YYYY')
      expect(res.body.settings.timeFormat).toBe('12h')
      expect(res.body.settings.defaultAppointmentDuration).toBe(45)
    })

    it('should update notification settings', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          emailNotifications: false,
          smsNotifications: true,
          appointmentReminders: false,
        })

      expect(res.status).toBe(200)
      expect(res.body.settings.emailNotifications).toBe(false)
      expect(res.body.settings.smsNotifications).toBe(true)
      expect(res.body.settings.appointmentReminders).toBe(false)
    })

    it('should update business hours', async () => {
      const businessHours = {
        '1': { start: '08:00', end: '17:00' },
        '2': { start: '08:00', end: '17:00' },
      }

      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ businessHours })

      expect(res.status).toBe(200)
      expect(res.body.settings.businessHours).toEqual(businessHours)
    })

    it('should update working days', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ workingDays: [1, 2, 3, 4, 5, 6] })

      expect(res.status).toBe(200)
      expect(res.body.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should reject invalid language', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ language: 'invalid' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation Error')
    })

    it('should reject invalid date format', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ dateFormat: 'invalid' })

      expect(res.status).toBe(400)
    })

    it('should reject appointment duration out of range', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ defaultAppointmentDuration: 500 })

      expect(res.status).toBe(400)
    })

    // Task #239: per-tenant map of appointment type -> duration (minutes).
    describe('appointmentTypeDurations', () => {
      it('should accept a valid appointmentTypeDurations array and return the stored value', async () => {
        const appointmentTypeDurations = [
          { type: 'Limpieza', duration: 30 },
          { type: 'Extraccion', duration: 60 },
        ]

        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations })

        expect(res.status).toBe(200)
        expect(res.body.settings.appointmentTypeDurations).toEqual(appointmentTypeDurations)
      })

      it('should accept the 5 minute minimum and 240 minute maximum durations', async () => {
        const appointmentTypeDurations = [
          { type: 'Muy corta', duration: 5 },
          { type: 'Muy larga', duration: 240 },
        ]

        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations })

        expect(res.status).toBe(200)
        expect(res.body.settings.appointmentTypeDurations).toEqual(appointmentTypeDurations)
      })

      it('should reject a duration below the 5 minute minimum', async () => {
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type: 'Rapida', duration: 4 }] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Validation Error')
      })

      it('should reject a duration above the 240 minute maximum', async () => {
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type: 'Cirugia larga', duration: 241 }] })

        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Validation Error')
      })

      it('should reject duplicate type names, case-insensitively', async () => {
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            appointmentTypeDurations: [
              { type: 'Limpieza', duration: 30 },
              { type: 'limpieza', duration: 45 },
            ],
          })

        expect(res.status).toBe(400)
        expect(res.body.details).toBeDefined()
        expect(res.body.details[0].message).toContain('Appointment type names must be unique')
      })

      it('should reject more than 20 entries', async () => {
        const appointmentTypeDurations = Array.from({ length: 21 }, (_, i) => ({
          type: `Tipo ${i}`,
          duration: 30,
        }))

        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations })

        expect(res.status).toBe(400)
      })

      it('should accept exactly 20 entries', async () => {
        const appointmentTypeDurations = Array.from({ length: 20 }, (_, i) => ({
          type: `Tipo ${i}`,
          duration: 30,
        }))

        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations })

        expect(res.status).toBe(200)
        expect(res.body.settings.appointmentTypeDurations).toHaveLength(20)
      })

      it('should reject an empty type string', async () => {
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type: '', duration: 30 }] })

        expect(res.status).toBe(400)
      })

      it('should reject a type string longer than 60 characters', async () => {
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type: 'a'.repeat(61), duration: 30 }] })

        expect(res.status).toBe(400)
      })

      it('should accept a type string at exactly 60 characters', async () => {
        const type = 'a'.repeat(60)
        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type, duration: 30 }] })

        expect(res.status).toBe(200)
        expect(res.body.settings.appointmentTypeDurations).toEqual([{ type, duration: 30 }])
      })

      it('should accept an empty array, clearing previously configured types', async () => {
        // Seed a non-empty value first so this exercises actually clearing it,
        // not merely never having set it.
        await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [{ type: 'Consulta', duration: 20 }] })

        const res = await api()
          .put('/api/settings')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ appointmentTypeDurations: [] })

        expect(res.status).toBe(200)
        expect(res.body.settings.appointmentTypeDurations).toEqual([])
      })
    })

    it('should reject businessHours where end time is before start time', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          businessHours: {
            1: { start: '18:00', end: '09:00' },
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.details).toBeDefined()
      expect(res.body.details[0].message).toContain(
        'End time must be after start time'
      )
    })

    it('should reject businessHours where end time equals start time', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          businessHours: {
            1: { start: '09:00', end: '09:00' },
          },
        })

      expect(res.status).toBe(400)
    })

    it('should reject workingDays with duplicate values', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ workingDays: [1, 1, 2, 2] })

      expect(res.status).toBe(400)
      expect(res.body.details).toBeDefined()
      expect(res.body.details[0].message).toContain('Working days must be unique')
    })

    it('should accept valid businessHours with end after start', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          businessHours: {
            1: { start: '09:00', end: '18:00' },
            2: { start: '08:30', end: '17:30' },
          },
        })

      expect(res.status).toBe(200)
      expect(res.body.settings.businessHours['1'].start).toBe('09:00')
    })

    it('should accept valid unique workingDays', async () => {
      const res = await api()
        .put('/api/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ workingDays: [0, 1, 2, 3, 4] })

      expect(res.status).toBe(200)
      expect(res.body.settings.workingDays).toEqual([0, 1, 2, 3, 4])
    })
  })

  describe('GET /api/tenant/profile', () => {
    it('should return 401 without auth', async () => {
      const res = await api().get('/api/tenant/profile')

      expect(res.status).toBe(401)
    })

    it('should return tenant profile', async () => {
      const res = await api()
        .get('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.tenant).toBeDefined()
      expect(res.body.tenant.id).toBe(tenantId)
      expect(res.body.tenant.name).toBe('Settings Test Clinic')
      expect(res.body.tenant.slug).toBeDefined()
      expect(res.body.tenant.timezone).toBeDefined()
      expect(res.body.tenant.currency).toBeDefined()
    })

    it('should allow staff to read profile', async () => {
      const res = await api()
        .get('/api/tenant/profile')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.tenant).toBeDefined()
    })
  })

  describe('PUT /api/tenant/profile', () => {
    it('should return 401 without auth', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .send({ name: 'New Name' })

      expect(res.status).toBe(401)
    })

    it('should return 403 for staff trying to update', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'New Name' })

      expect(res.status).toBe(403)
    })

    it('should update tenant name', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Clinic Name' })

      expect(res.status).toBe(200)
      expect(res.body.tenant.name).toBe('Updated Clinic Name')
    })

    it('should update tenant contact info', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          email: 'clinic@example.com',
          phone: '+1234567890',
          address: '123 Main St, City',
        })

      expect(res.status).toBe(200)
      expect(res.body.tenant.email).toBe('clinic@example.com')
      expect(res.body.tenant.phone).toBe('+1234567890')
      expect(res.body.tenant.address).toBe('123 Main St, City')
    })

    it('should update timezone and currency', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          timezone: 'America/Montevideo',
          currency: 'UYU',
        })

      expect(res.status).toBe(200)
      expect(res.body.tenant.timezone).toBe('America/Montevideo')
      expect(res.body.tenant.currency).toBe('UYU')
    })

    it('should reject invalid email', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'not-an-email' })

      expect(res.status).toBe(400)
    })

    it('should reject invalid currency length', async () => {
      const res = await api()
        .put('/api/tenant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ currency: 'INVALID' })

      expect(res.status).toBe(400)
    })
  })
})
