import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as userService from './user.service.js'

// Mock prisma
vi.mock('@dental/database', () => ({
  prisma: {
    subscription: {
      findUnique: vi.fn(),
    },
    user: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    CLINIC_ADMIN: 'CLINIC_ADMIN',
    DOCTOR: 'DOCTOR',
    STAFF: 'STAFF',
  },
}))

// Mock auth service
vi.mock('./auth.service.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_password'),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { prisma } from '@dental/database'

describe('user.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTenantPlanLimits', () => {
    it('should return default free plan limits when no subscription exists', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)

      const limits = await userService.getTenantPlanLimits('tenant-1')

      expect(limits).toEqual({
        maxAdmins: 1,
        maxDoctors: 3,
        maxPatients: 50,
      })
    })

    it('should return plan limits from subscription', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        id: 'sub-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        plan: {
          id: 'plan-1',
          name: 'basic',
          maxAdmins: 2,
          maxDoctors: 5,
          maxPatients: 25,
        },
      } as never)

      const limits = await userService.getTenantPlanLimits('tenant-1')

      expect(limits).toEqual({
        maxAdmins: 2,
        maxDoctors: 5,
        maxPatients: 25,
      })
    })
  })

  describe('countUsersByRole', () => {
    it('should return counts for all roles', async () => {
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'OWNER', _count: { id: 1 } },
        { role: 'ADMIN', _count: { id: 2 } },
        { role: 'DOCTOR', _count: { id: 3 } },
      ] as never)

      const counts = await userService.countUsersByRole('tenant-1')

      expect(counts).toEqual({
        OWNER: 1,
        ADMIN: 2,
        CLINIC_ADMIN: 0,
        DOCTOR: 3,
        STAFF: 0,
      })
    })
  })

  describe('checkRoleLimitForNewUser', () => {
    it('should allow adding staff (no limit)', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'STAFF', _count: { id: 100 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'STAFF')

      expect(result.allowed).toBe(true)
    })

    it('should deny adding admin when limit reached', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null) // free plan: 1 admin
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'OWNER', _count: { id: 1 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'ADMIN')

      expect(result.allowed).toBe(false)
      expect(result.message).toContain('Admin limit reached')
    })

    it('should deny adding doctor when limit reached', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null) // free plan: 3 doctors
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'DOCTOR', _count: { id: 3 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'DOCTOR')

      expect(result.allowed).toBe(false)
      expect(result.message).toContain('Doctor limit reached')
    })

    it('should deny adding CLINIC_ADMIN when admin limit reached', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null) // free plan: 1 admin
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'OWNER', _count: { id: 1 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'CLINIC_ADMIN')

      expect(result.allowed).toBe(false)
      expect(result.message).toContain('Admin limit reached')
    })

    it('should count CLINIC_ADMIN toward admin limit', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null) // free plan: 1 admin
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'CLINIC_ADMIN', _count: { id: 1 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'ADMIN')

      expect(result.allowed).toBe(false)
      expect(result.message).toContain('Admin limit reached')
    })

    it('should allow adding doctor when under limit', async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.groupBy).mockResolvedValue([
        { role: 'DOCTOR', _count: { id: 2 } },
      ] as never)

      const result = await userService.checkRoleLimitForNewUser('tenant-1', 'DOCTOR')

      expect(result.allowed).toBe(true)
    })
  })

  describe('listUsers', () => {
    it('should list active users for tenant', async () => {
      const mockUsers = [
        { id: 'user-1', email: 'user1@test.com', firstName: 'User', lastName: 'One', pinHash: null },
        { id: 'user-2', email: 'user2@test.com', firstName: 'User', lastName: 'Two', pinHash: null },
      ]
      vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as never)

      const users = await userService.listUsers('tenant-1')

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', isActive: true },
        })
      )
      expect(users).toEqual([
        { id: 'user-1', email: 'user1@test.com', firstName: 'User', lastName: 'One', hasPinSet: false },
        { id: 'user-2', email: 'user2@test.com', firstName: 'User', lastName: 'Two', hasPinSet: false },
      ])
    })

    it('should include inactive users when requested', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([])

      await userService.listUsers('tenant-1', { includeInactive: true })

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
        })
      )
    })
  })

  describe('getUserById', () => {
    it('should return user when found in tenant', async () => {
      const mockUser = { id: 'user-1', email: 'user1@test.com', tenantId: 'tenant-1', pinHash: null }
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as never)

      const user = await userService.getUserById('tenant-1', 'user-1')

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', tenantId: 'tenant-1' },
        select: expect.any(Object),
      })
      expect(user).toEqual({ id: 'user-1', email: 'user1@test.com', tenantId: 'tenant-1', hasPinSet: false })
    })

    it('should return null when user not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

      const user = await userService.getUserById('tenant-1', 'non-existent')

      expect(user).toBeNull()
    })

    it('should enforce tenant isolation (not return user from different tenant)', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

      const user = await userService.getUserById('tenant-2', 'user-from-tenant-1')

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-from-tenant-1', tenantId: 'tenant-2' },
        select: expect.any(Object),
      })
      expect(user).toBeNull()
    })
  })

  describe('updateUser', () => {
    const admin = { userId: 'admin-1', role: 'ADMIN' }

    it('should update user when found in tenant', async () => {
      const mockUser = { id: 'user-1', email: 'updated@test.com', firstName: 'Updated', pinHash: null }
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'STAFF' } as never)
      vi.mocked(prisma.user.update).mockResolvedValue(mockUser as never)

      const result = await userService.updateUser(
        'tenant-1',
        'user-1',
        { email: 'updated@test.com', firstName: 'Updated' },
        admin
      )

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { email: 'updated@test.com', firstName: 'Updated' },
        select: expect.any(Object),
      })
      expect(result).toEqual({
        ok: true,
        user: { id: 'user-1', email: 'updated@test.com', firstName: 'Updated', hasPinSet: false },
      })
    })

    it('should report not found when user not found in tenant', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

      const result = await userService.updateUser('tenant-1', 'non-existent', { firstName: 'Updated' }, admin)

      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('should enforce tenant isolation on update', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

      await userService.updateUser('tenant-2', 'user-from-tenant-1', { firstName: 'Hacked' }, admin)

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-from-tenant-1', tenantId: 'tenant-2' },
        select: { id: true, role: true },
      })
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    describe('role hierarchy for email and active status', () => {
      // A requester may change another user's email or active status only when
      // that user's role is strictly lower than the requester's. The same
      // hierarchy governs role changes.
      it.each([
        ['an equal role', 'ADMIN', 'ADMIN'],
        ['a higher role', 'ADMIN', 'OWNER'],
        ['an equal role, at the top', 'OWNER', 'OWNER'],
        ['a higher role, from further down', 'CLINIC_ADMIN', 'ADMIN'],
      ])('rejects changing the email of a user with %s', async (_label, actorRole, targetRole) => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: targetRole } as never)

        const result = await userService.updateUser(
          'tenant-1',
          'target',
          { email: 'new@test.com' },
          { userId: 'actor', role: actorRole }
        )

        expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' })
        expect(prisma.user.update).not.toHaveBeenCalled()
      })

      it.each([
        ['an equal role', 'ADMIN', 'ADMIN'],
        ['a higher role', 'ADMIN', 'OWNER'],
      ])('rejects changing the active status of a user with %s', async (_label, actorRole, targetRole) => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: targetRole } as never)

        const result = await userService.updateUser(
          'tenant-1',
          'target',
          { isActive: false },
          { userId: 'actor', role: actorRole }
        )

        expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' })
        expect(prisma.user.update).not.toHaveBeenCalled()
      })

      it('allows changing the email and active status of a user with a strictly lower role', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: 'STAFF' } as never)
        vi.mocked(prisma.user.update).mockResolvedValue({ id: 'target', pinHash: null } as never)

        const result = await userService.updateUser(
          'tenant-1',
          'target',
          { email: 'new@test.com', isActive: false },
          admin
        )

        expect(result).toMatchObject({ ok: true })
        expect(prisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { email: 'new@test.com', isActive: false } })
        )
      })

      it('allows a user to change their own email regardless of role', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never)
        vi.mocked(prisma.user.update).mockResolvedValue({ id: 'admin-1', pinHash: null } as never)

        const result = await userService.updateUser('tenant-1', 'admin-1', { email: 'me@test.com' }, admin)

        expect(result).toMatchObject({ ok: true })
        expect(prisma.user.update).toHaveBeenCalled()
      })

      it('treats an unrecognised requester role as the lowest, never as privileged', async () => {
        vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: 'STAFF' } as never)

        const result = await userService.updateUser(
          'tenant-1',
          'target',
          { email: 'new@test.com' },
          { userId: 'actor', role: 'SUPER_ADMIN' }
        )

        expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' })
        expect(prisma.user.update).not.toHaveBeenCalled()
      })
    })
  })

  describe('createUser', () => {
    it('should create a user with hashed password', async () => {
      const mockUser = {
        id: 'new-user',
        email: 'new@test.com',
        firstName: 'New',
        lastName: 'User',
        role: 'STAFF',
        pinHash: null,
      }
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as never)

      const user = await userService.createUser('tenant-1', {
        email: 'new@test.com',
        password: 'Password123!',
        firstName: 'New',
        lastName: 'User',
        role: 'STAFF',
      })

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            email: 'new@test.com',
            passwordHash: 'hashed_password',
            role: 'STAFF',
          }),
        })
      )
      expect(user).toEqual({
        id: 'new-user',
        email: 'new@test.com',
        firstName: 'New',
        lastName: 'User',
        role: 'STAFF',
        hasPinSet: false,
      })
    })
  })

  describe('updateUserRole', () => {
    it('should prevent non-owners from promoting to OWNER', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'STAFF' } as never)

      const result = await userService.updateUserRole('tenant-1', 'user-1', 'OWNER', 'ADMIN')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Only owners can promote')
    })

    it('should prevent changing role to SUPER_ADMIN', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'STAFF' } as never)

      const result = await userService.updateUserRole('tenant-1', 'user-1', 'SUPER_ADMIN', 'OWNER')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot set role to SUPER_ADMIN')
    })

    it('should allow owner to promote user to OWNER', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'ADMIN' } as never)
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.groupBy).mockResolvedValue([{ role: 'OWNER', _count: { id: 0 } }] as never)
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'user-1', role: 'OWNER' } as never)

      const result = await userService.updateUserRole('tenant-1', 'user-1', 'OWNER', 'OWNER')

      expect(result.success).toBe(true)
    })

    it('should skip limit check when role is not changing', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'DOCTOR' } as never)
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'user-1', role: 'DOCTOR' } as never)

      const result = await userService.updateUserRole('tenant-1', 'user-1', 'DOCTOR', 'ADMIN')

      // Should not check limits since role is the same
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled()
      expect(prisma.user.groupBy).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  describe('deleteUser', () => {
    // The actor: the shared login's user, the effective person (the PIN profile
    // when one is active, else the login), and the effective role.
    const actor = (over: Partial<userService.UserDeleteActor> = {}): userService.UserDeleteActor => ({
      loginUserId: 'admin-1',
      actorUserId: 'admin-1',
      role: 'ADMIN',
      ...over,
    })

    it('should prevent self-deletion', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'ADMIN' } as never)

      const result = await userService.deleteUser(
        'tenant-1',
        'user-1',
        actor({ loginUserId: 'user-1', actorUserId: 'user-1' })
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot delete your own account')
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it("rejects deleting the active PIN profile's own person", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'person-1', role: 'STAFF' } as never)

      const result = await userService.deleteUser(
        'tenant-1',
        'person-1',
        actor({ loginUserId: 'login-1', actorUserId: 'person-1' })
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot delete your own account')
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('rejects deleting the account of the login in use, even when its role is lower', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'login-1', role: 'STAFF' } as never)

      const result = await userService.deleteUser(
        'tenant-1',
        'login-1',
        actor({ loginUserId: 'login-1', actorUserId: 'person-1', role: 'ADMIN' })
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot delete your own account')
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('should prevent deleting owners', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'OWNER' } as never)

      const result = await userService.deleteUser('tenant-1', 'user-1', actor({ role: 'OWNER' }))

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot delete an owner')
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it.each([
      ['an equal role', 'ADMIN', 'ADMIN'],
      ['a higher role', 'CLINIC_ADMIN', 'ADMIN'],
      ['an equal role, further down', 'DOCTOR', 'DOCTOR'],
    ])('rejects deleting a user with %s', async (_label, actorRole, targetRole) => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: targetRole } as never)

      const result = await userService.deleteUser('tenant-1', 'target', actor({ role: actorRole }))

      expect(result.success).toBe(false)
      expect(result.error).toContain('higher role')
      expect(prisma.user.update).not.toHaveBeenCalled()
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled()
    })

    it('treats an unrecognised requester role as the lowest, never as privileged', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'target', role: 'STAFF' } as never)

      const result = await userService.deleteUser('tenant-1', 'target', actor({ role: 'SUPER_ADMIN' }))

      expect(result.success).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('should soft delete a user with a strictly lower role and invalidate their tokens', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', role: 'STAFF' } as never)
      vi.mocked(prisma.user.update).mockResolvedValue({} as never)
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 })

      const result = await userService.deleteUser('tenant-1', 'user-1', actor())

      expect(result.success).toBe(true)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        })
      )
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      })
    })
  })
})
