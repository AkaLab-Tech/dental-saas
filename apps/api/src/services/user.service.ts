import { randomBytes } from 'node:crypto'
import { prisma, UserRole } from '@dental/database'
import { hashPassword } from './auth.service.js'
import { logger } from '../utils/logger.js'

// Fields to select from user queries (includes pinHash for hasPinSet derivation)
const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatar: true,
  phone: true,
  pinHash: true,
  emailVerified: true,
  lastLoginAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

export type SafeUser = {
  id: string
  tenantId: string | null
  email: string
  firstName: string
  lastName: string
  role: UserRole
  avatar: string | null
  phone: string | null
  hasPinSet: boolean
  emailVerified: boolean
  lastLoginAt: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Strip pinHash and add hasPinSet boolean */
function toSafeUser(user: { pinHash: string | null; [key: string]: unknown }): SafeUser {
  const { pinHash, ...rest } = user
  return { ...rest, hasPinSet: !!pinHash } as SafeUser
}

/**
 * Get plan limits for a tenant
 */
export async function getTenantPlanLimits(tenantId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })

  if (!subscription || !subscription.plan) {
    // No subscription = free plan limits
    return {
      maxAdmins: 1,
      maxDoctors: 3,
      maxPatients: 50,
    }
  }

  return {
    maxAdmins: subscription.plan.maxAdmins,
    maxDoctors: subscription.plan.maxDoctors,
    maxPatients: subscription.plan.maxPatients,
  }
}

/**
 * Count users by role for a tenant
 */
export async function countUsersByRole(tenantId: string) {
  const counts = await prisma.user.groupBy({
    by: ['role'],
    where: { tenantId, isActive: true },
    _count: { id: true },
  })

  const result: Record<string, number> = {
    OWNER: 0,
    ADMIN: 0,
    CLINIC_ADMIN: 0,
    DOCTOR: 0,
    STAFF: 0,
  }

  for (const item of counts) {
    result[item.role] = item._count.id
  }

  return result
}

/**
 * Check if adding a user with a specific role would exceed plan limits
 */
export async function checkRoleLimitForNewUser(
  tenantId: string,
  role: UserRole
): Promise<{ allowed: boolean; message?: string; currentCount?: number; limit?: number }> {
  const limits = await getTenantPlanLimits(tenantId)
  const counts = await countUsersByRole(tenantId)

  // Check based on role
  if (role === 'ADMIN' || role === 'OWNER' || role === 'CLINIC_ADMIN') {
    // OWNER, ADMIN, and CLINIC_ADMIN share the maxAdmins limit
    const adminCount = counts.OWNER + counts.ADMIN + counts.CLINIC_ADMIN
    if (adminCount >= limits.maxAdmins) {
      return {
        allowed: false,
        message: `Admin limit reached. Your plan allows ${limits.maxAdmins} admin(s). Upgrade to add more.`,
        currentCount: adminCount,
        limit: limits.maxAdmins,
      }
    }
  }

  if (role === 'DOCTOR') {
    if (counts.DOCTOR >= limits.maxDoctors) {
      return {
        allowed: false,
        message: `Doctor limit reached. Your plan allows ${limits.maxDoctors} doctor(s). Upgrade to add more.`,
        currentCount: counts.DOCTOR,
        limit: limits.maxDoctors,
      }
    }
  }

  // STAFF has no limit in current plan structure
  return { allowed: true }
}

/**
 * List all users for a tenant
 */
export async function listUsers(
  tenantId: string,
  options?: { limit?: number; offset?: number; includeInactive?: boolean }
): Promise<SafeUser[]> {
  const { limit = 50, offset = 0, includeInactive = false } = options || {}

  const users = await prisma.user.findMany({
    where: {
      tenantId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: USER_SELECT,
    take: Math.min(limit, 100),
    skip: offset,
    orderBy: { createdAt: 'desc' },
  })

  return users.map(toSafeUser)
}

/**
 * Get a single user by ID (with tenant isolation)
 */
export async function getUserById(tenantId: string, userId: string): Promise<SafeUser | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: USER_SELECT,
  })

  return user ? toSafeUser(user) : null
}

/**
 * Create a new user for a tenant
 */
export async function createUser(
  tenantId: string,
  data: {
    email: string
    password: string
    firstName: string
    lastName: string
    role: UserRole
    phone?: string
    avatar?: string
  }
): Promise<SafeUser> {
  const { email, password, firstName, lastName, role, phone, avatar } = data

  // Hash password
  const passwordHash = await hashPassword(password)

  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      phone,
      avatar,
    },
    select: USER_SELECT,
  })

  logger.info({ userId: user.id, tenantId, role }, 'User created')

  return toSafeUser(user)
}

/**
 * Create a profile-only user (no email/password login).
 * Generates a placeholder email and random password hash so the DB schema is satisfied.
 * The user authenticates exclusively via PIN on the lock screen.
 */
export async function createProfile(
  tenantId: string,
  data: {
    firstName: string
    lastName: string
    role: UserRole
  }
): Promise<SafeUser> {
  const { firstName, lastName, role } = data

  // Generate a unique placeholder email that won't collide
  const randomId = randomBytes(8).toString('hex')
  const placeholderEmail = `profile-${randomId}@noreply.internal`

  // Random password hash — this user can never log in via email/password
  const randomPassword = randomBytes(32).toString('hex')
  const passwordHash = await hashPassword(randomPassword)

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: placeholderEmail,
      passwordHash,
      firstName,
      lastName,
      role,
    },
    select: USER_SELECT,
  })

  logger.info({ userId: user.id, tenantId, role, profileOnly: true }, 'Profile created')

  return toSafeUser(user)
}

/**
 * Update a user
 */
export async function updateUser(
  tenantId: string,
  userId: string,
  data: {
    email?: string
    firstName?: string
    lastName?: string
    phone?: string
    avatar?: string
    isActive?: boolean
  }
): Promise<SafeUser | null> {
  // Verify user belongs to tenant
  const existing = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    return null
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: USER_SELECT,
  })

  logger.info({ userId, tenantId }, 'User updated')

  return toSafeUser(user)
}

/**
 * Update user role (separate function for role changes)
 */
export async function updateUserRole(
  tenantId: string,
  userId: string,
  newRole: UserRole,
  requestingUserRole: UserRole
): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  // Verify user belongs to tenant
  const existing = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, role: true },
  })

  if (!existing) {
    return { success: false, error: 'User not found' }
  }

  // Prevent non-owners from changing roles to OWNER
  if (newRole === 'OWNER' && requestingUserRole !== 'OWNER') {
    return { success: false, error: 'Only owners can promote users to owner' }
  }

  // Prevent demoting owners (only owner can demote themselves)
  if (existing.role === 'OWNER' && requestingUserRole !== 'OWNER') {
    return { success: false, error: 'Cannot demote an owner' }
  }

  // Prevent changing to SUPER_ADMIN
  if (newRole === 'SUPER_ADMIN') {
    return { success: false, error: 'Cannot set role to SUPER_ADMIN' }
  }

  // Check limits for the new role only if the role is actually changing
  if (existing.role !== newRole) {
    const limitCheck = await checkRoleLimitForNewUser(tenantId, newRole)
    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.message }
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: newRole },
    select: USER_SELECT,
  })

  logger.info({ userId, tenantId, oldRole: existing.role, newRole }, 'User role updated')

  return { success: true, user: toSafeUser(user) }
}

/**
 * Soft delete a user (set isActive = false)
 */
export async function deleteUser(
  tenantId: string,
  userId: string,
  requestingUserId: string
): Promise<{ success: boolean; error?: string }> {
  // Verify user belongs to tenant
  const existing = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, role: true },
  })

  if (!existing) {
    return { success: false, error: 'User not found' }
  }

  // Prevent self-deletion
  if (userId === requestingUserId) {
    return { success: false, error: 'Cannot delete your own account' }
  }

  // Prevent deleting owners (must transfer ownership first)
  if (existing.role === 'OWNER') {
    return { success: false, error: 'Cannot delete an owner. Transfer ownership first.' }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  })

  // Invalidate all refresh tokens for the deleted user
  await prisma.refreshToken.deleteMany({
    where: { userId },
  })

  logger.info({ userId, tenantId }, 'User deleted (soft)')

  return { success: true }
}

/**
 * Get user count for a tenant
 */
export async function getUserCount(tenantId: string): Promise<number> {
  return prisma.user.count({
    where: { tenantId, isActive: true },
  })
}

/**
 * Set or update a user's 4-digit PIN
 */
export async function setUserPin(tenantId: string, userId: string, pin: string): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true },
  })

  if (!existing) {
    throw new Error('User not found')
  }

  const pinHash = await hashPassword(pin)
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  })

  logger.info({ userId, tenantId }, 'User PIN set')
}
