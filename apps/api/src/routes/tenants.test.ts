import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'

// Mock Prisma
vi.mock('@dental/database', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
  Prisma: {
    JsonNull: { __brand: 'JsonNull' }, // Mock JsonNull for doctor.service.ts
  },
}))

// Helper to create mock tenant
const mockTenant = (overrides = {}) => ({
  id: 'tenant-123',
  name: 'Test Clinic',
  slug: 'test-clinic',
  email: null,
  phone: null,
  address: null,
  logo: null,
  timezone: 'UTC',
  currency: 'USD',
  storageUsedBytes: BigInt(0),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

describe('GET /api/tenants/check-slug/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('slug validation', () => {
    it('should reject slug shorter than 3 characters', async () => {
      const res = await api().get('/api/tenants/check-slug/ab')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('INVALID_SLUG')
    })

    it('should reject slug longer than 50 characters', async () => {
      const longSlug = 'a'.repeat(51)
      const res = await api().get(`/api/tenants/check-slug/${longSlug}`)

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('INVALID_SLUG')
    })

    it('should reject slug with uppercase letters', async () => {
      const res = await api().get('/api/tenants/check-slug/MyClinic')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('INVALID_SLUG')
    })

    it('should reject slug with special characters', async () => {
      const res = await api().get('/api/tenants/check-slug/my_clinic!')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('INVALID_SLUG')
    })

    it('should accept valid slug with lowercase letters, numbers, and hyphens', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null)

      const res = await api().get('/api/tenants/check-slug/my-clinic-123')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('availability check', () => {
    it('should return available: true when slug is not taken', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null)

      const res = await api().get('/api/tenants/check-slug/new-clinic')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.available).toBe(true)
      expect(res.body.data.slug).toBe('new-clinic')
      expect(res.body.data.suggestions).toBeUndefined()
    })

    it('should return available: false with suggestions when slug is taken', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant())
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([])

      const res = await api().get('/api/tenants/check-slug/taken-clinic')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.available).toBe(false)
      expect(res.body.data.slug).toBe('taken-clinic')
      expect(res.body.data.suggestions).toBeInstanceOf(Array)
      expect(res.body.data.suggestions.length).toBeLessThanOrEqual(3)
    })

    it('should filter out taken suggestions', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant())
      // Simulate that 'clinic-1' is also taken
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([mockTenant({ slug: 'clinic-1' })])

      const res = await api().get('/api/tenants/check-slug/clinic')

      expect(res.status).toBe(200)
      expect(res.body.data.suggestions).not.toContain('clinic-1')
    })

    it('should return max 3 suggestions', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant())
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([])

      const res = await api().get('/api/tenants/check-slug/myclinic')

      expect(res.status).toBe(200)
      expect(res.body.data.suggestions.length).toBeLessThanOrEqual(3)
    })
  })

  describe('suggestion generation', () => {
    it('should generate numeric suffixes', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant())
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([])

      const res = await api().get('/api/tenants/check-slug/test')

      expect(res.status).toBe(200)
      const suggestions = res.body.data.suggestions
      expect(suggestions).toContain('test-1')
      expect(suggestions).toContain('test-2')
    })
  })
})
