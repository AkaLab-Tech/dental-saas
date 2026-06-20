import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, verifyProfileToken, type TokenPayload } from '../services/auth.service.js'

// Extend Express Request type to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

/**
 * Middleware that requires a valid JWT access token.
 * Attaches the decoded user payload to req.user
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { message: 'Missing authorization header', code: 'UNAUTHENTICATED' },
    })
  }

  const token = authHeader.slice(7)

  try {
    const payload = verifyAccessToken(token)
    req.user = payload
  } catch {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' },
    })
  }

  // Check for profile token (two-token PIN auth)
  const profileHeader = req.headers['x-profile-token']
  if (typeof profileHeader === 'string' && profileHeader) {
    try {
      const profile = verifyProfileToken(profileHeader)
      if (profile.tenantId === req.user!.tenantId) {
        req.user!.role = profile.role
        req.user!.profileUserId = profile.profileUserId
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: { message: 'Profile session expired', code: 'PROFILE_TOKEN_EXPIRED' },
      })
    }
  }

  next()
}

/**
 * Middleware that requires the user to have one of the specified roles.
 * Must be used after requireAuth.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
      })
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Insufficient permissions',
          code: 'FORBIDDEN',
          requiredRoles: allowedRoles,
          userRole: req.user.role,
        },
      })
    }

    next()
  }
}

/**
 * Middleware that validates tenant from JWT matches request.
 * Stores tenantId in req.user (already there from requireAuth).
 * Must be used after requireAuth.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
    })
  }

  // tenantId is already in req.user from JWT - no need to mutate headers
  // Routes should use req.user.tenantId instead of x-tenant-id header

  next()
}

/**
 * Combined middleware: requireAuth + requireTenant
 */
export function requireAuthWithTenant(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err) => {
    if (err) return next(err)
    if (res.headersSent) return // Response already sent by requireAuth
    requireTenant(req, res, next)
  })
}

/**
 * Role hierarchy for permission checks (tenant-scoped roles only)
 */
export const ROLE_HIERARCHY = {
  OWNER: 5,
  ADMIN: 4,
  CLINIC_ADMIN: 3,
  DOCTOR: 2,
  STAFF: 1,
} as const

/**
 * Check if a user role has at least the minimum required level
 */
export function hasMinRole(userRole: string, minRole: keyof typeof ROLE_HIERARCHY): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as keyof typeof ROLE_HIERARCHY] ?? 0
  const minLevel = ROLE_HIERARCHY[minRole]
  return userLevel >= minLevel
}

/**
 * Middleware that requires minimum role level (uses hierarchy)
 */
export function requireMinRole(minRole: keyof typeof ROLE_HIERARCHY) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
      })
    }

    if (!hasMinRole(req.user.role, minRole)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Insufficient permissions',
          code: 'FORBIDDEN',
          minimumRole: minRole,
          userRole: req.user.role,
        },
      })
    }

    next()
  }
}

/**
 * Middleware that requires SUPER_ADMIN role.
 * Super admins are platform-level administrators with no tenant.
 * Must be used after requireAuth.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
    })
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Super admin access required',
        code: 'FORBIDDEN',
      },
    })
  }

  next()
}

/**
 * Middleware that accepts a JWT from the Authorization header OR a ?token= query param.
 * Use this for routes that need to be accessible via direct URL (e.g. <img src>).
 */
export function requireAuthWithTokenParam(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  // Prefer Authorization header, fall back to ?token query param
  let token: string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { message: 'Missing authorization', code: 'UNAUTHENTICATED' },
    })
  }

  try {
    const payload = verifyAccessToken(token)
    req.user = payload
    next()
  } catch {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' },
    })
  }
}

/**
 * Combined middleware: requireAuth + requireSuperAdmin
 */
export function requireAuthAsSuperAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err) => {
    if (err) return next(err)
    if (res.headersSent) return
    requireSuperAdmin(req, res, next)
  })
}
