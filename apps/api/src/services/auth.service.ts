import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import type { StringValue } from 'ms'
import crypto from 'crypto'
import { env } from '../config/env.js'
import { prisma } from '@dental/database'

const SALT_ROUNDS = 12

// Maximum refresh tokens per user (cleanup old ones)
export const MAX_REFRESH_TOKENS_PER_USER = 5

// Types
export interface TokenPayload {
  userId: string
  tenantId: string
  email: string
  role: string
  profileUserId?: string
}

export interface ProfileTokenPayload {
  profileUserId: string
  role: string
  tenantId: string
  type: 'profile'
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Generate access and refresh tokens
 */
export function generateTokens(payload: TokenPayload): TokenPair {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as StringValue,
  })

  // Refresh token has a different structure - just contains userId
  const refreshToken = jwt.sign(
    { userId: payload.userId, type: 'refresh' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN as StringValue }
  )

  return { accessToken, refreshToken }
}

/**
 * Verify an access token
 * @throws Error with descriptive message if token is invalid
 */
export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload & { type?: string }
  
  // Make sure it's not a refresh token
  if (decoded.type === 'refresh') {
    const error = new Error('Invalid token type: expected access token, got refresh token')
    ;(error as Error & { code?: string }).code = 'INVALID_TOKEN_TYPE'
    throw error
  }
  
  return decoded
}

/**
 * Verify a refresh token
 * @throws Error with descriptive message if token is invalid
 */
export function verifyRefreshToken(token: string): { userId: string } {
  const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; type?: string }
  
  if (decoded.type !== 'refresh') {
    const error = new Error('Invalid token type: expected refresh token')
    ;(error as Error & { code?: string }).code = 'INVALID_TOKEN_TYPE'
    throw error
  }
  
  return { userId: decoded.userId }
}

/**
 * Generate a profile token (lightweight JWT for active user identification)
 */
export function generateProfileToken(payload: Omit<ProfileTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'profile' }, env.JWT_SECRET, { expiresIn: '24h' })
}

/**
 * Verify a profile token
 * @throws Error if token is invalid or not a profile token
 */
export function verifyProfileToken(token: string): ProfileTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as ProfileTokenPayload
  if (decoded.type !== 'profile') {
    throw new Error('Invalid token type: expected profile token')
  }
  return decoded
}

/**
 * Hash a refresh token for storage
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Parse expiry string to Date
 * @throws Error if format is invalid
 */
export function getExpiryDate(expiresIn: string): Date {
  const match = expiresIn.match(/^(\d+)([smhd])$/)
  if (!match) {
    throw new Error(`Invalid expiresIn format: "${expiresIn}". Expected pattern "<number><unit>" where unit is one of s, m, h, d.`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return new Date(Date.now() + value * multipliers[unit])
}

/**
 * Clean up old refresh tokens for a user, keeping only the most recent ones
 */
export async function cleanupOldRefreshTokens(userId: string): Promise<void> {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  if (tokens.length > MAX_REFRESH_TOKENS_PER_USER) {
    const tokensToDelete = tokens.slice(MAX_REFRESH_TOKENS_PER_USER)
    await prisma.refreshToken.deleteMany({
      where: { id: { in: tokensToDelete.map((t) => t.id) } },
    })
  }
}
