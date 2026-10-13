// Shared types for Alveo System

/**
 * User roles in the system
 * These must match the UserRole enum in the Prisma schema
 */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',   // Platform super administrator, no tenant
  OWNER = 'OWNER',               // Tenant owner, full access
  ADMIN = 'ADMIN',               // Administrative access
  CLINIC_ADMIN = 'CLINIC_ADMIN', // Operational management (no user/settings management)
  DOCTOR = 'DOCTOR',             // Can manage patients and appointments
  STAFF = 'STAFF',               // Limited access
}

// For backward compatibility, export as Role as well
export type Role = UserRole

// Re-export permissions
export * from './permissions.js'

// Medical history (sections, criticality set, line format)
export * from './medical-history.js'

// Translation functions
export {
  t,
  formatDate,
  formatTime,
  formatDateTime,
  translateStatus,
  translateGender,
  sanitizeFilename,
  type Language,
} from './translations/index.js'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    message: string
    code: string
  }
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// Plan types
export type PlanSlug = 'free' | 'basic' | 'enterprise'

export interface PlanLimits {
  maxAdmins: number
  maxDoctors: number
  maxPatients: number
  maxStorageMb: number
}

export interface PlanFeatures {
  backups: 'manual' | 'daily' | 'daily_exportable'
  reports: 'basic' | 'complete' | 'custom'
  support: 'community' | 'email' | 'priority'
  apiAccess: boolean
}

// Common entity fields
export interface BaseEntity {
  id: string
  createdAt: Date
  updatedAt: Date
}

export interface TenantEntity extends BaseEntity {
  tenantId: string
}

export interface ArchivableEntity extends TenantEntity {
  archived: boolean
}

// Dental chart types
export enum ToothStatus {
  HEALTHY = 'healthy',
  CARIES = 'caries',
  FILLED = 'filled',
  CROWN = 'crown',
  ROOT_CANAL = 'root_canal',
  MISSING = 'missing',
  EXTRACTED = 'extracted',
  IMPLANT = 'implant',
  BRIDGE = 'bridge',
}

export interface ToothData {
  note: string
  status: ToothStatus
}

export type TeethData = Record<string, ToothData>

// Attachment types
export enum AttachmentModule {
  PATIENTS = 'PATIENTS',
  APPOINTMENTS = 'APPOINTMENTS',
  LABWORKS = 'LABWORKS',
  EXPENSES = 'EXPENSES',
}

export interface StorageUsage {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
  usedMb: number
  limitMb: number
  percentage: number
}

export interface AttachmentInfo {
  id: string
  module: AttachmentModule
  entityId: string
  filename: string
  mimeType: string
  sizeBytes: number
  description: string | null
  createdAt: string
}
