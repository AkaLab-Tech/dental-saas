import { UserRole } from './index.js';

/**
 * Granular permissions for the application
 * Each permission represents a specific action a user can perform
 */
export enum Permission {
  // Patients
  PATIENTS_VIEW = 'patients:view',
  PATIENTS_CREATE = 'patients:create',
  PATIENTS_UPDATE = 'patients:update',
  PATIENTS_DELETE = 'patients:delete',

  // Appointments
  APPOINTMENTS_VIEW = 'appointments:view',
  APPOINTMENTS_CREATE = 'appointments:create',
  APPOINTMENTS_UPDATE = 'appointments:update',
  APPOINTMENTS_DELETE = 'appointments:delete',

  // Doctors
  DOCTORS_VIEW = 'doctors:view',
  DOCTORS_CREATE = 'doctors:create',
  DOCTORS_UPDATE = 'doctors:update',
  DOCTORS_DELETE = 'doctors:delete',

  // Users
  USERS_VIEW = 'users:view',
  USERS_CREATE = 'users:create',
  USERS_UPDATE = 'users:update',
  USERS_DELETE = 'users:delete',
  USERS_PROMOTE_OWNER = 'users:promote_owner',

  // Labworks
  LABWORKS_VIEW = 'labworks:view',
  LABWORKS_CREATE = 'labworks:create',
  LABWORKS_UPDATE = 'labworks:update',
  LABWORKS_DELETE = 'labworks:delete',

  // Expenses
  EXPENSES_VIEW = 'expenses:view',
  EXPENSES_CREATE = 'expenses:create',
  EXPENSES_UPDATE = 'expenses:update',
  EXPENSES_DELETE = 'expenses:delete',

  // Settings
  SETTINGS_VIEW = 'settings:view',
  SETTINGS_UPDATE = 'settings:update',

  // Tenant
  TENANT_PROFILE_UPDATE = 'tenant:profile_update',
  TENANT_DELETE = 'tenant:delete',

  // Dental Charts
  DENTAL_CHARTS_VIEW = 'dental_charts:view',
  DENTAL_CHARTS_UPDATE = 'dental_charts:update',

  // Statistics
  STATISTICS_VIEW = 'statistics:view',

  // Export
  DATA_EXPORT = 'data:export',

  // Attachments
  ATTACHMENTS_VIEW = 'attachments:view',
  ATTACHMENTS_UPLOAD = 'attachments:upload',
  ATTACHMENTS_DELETE = 'attachments:delete',

  // Billing
  BILLING_VIEW = 'billing:view',
  BILLING_MANAGE = 'billing:manage',

  // Patient Payments
  PAYMENTS_VIEW = 'payments:view',
  PAYMENTS_CREATE = 'payments:create',
  PAYMENTS_DELETE = 'payments:delete',

  // Budgets (Presupuestos)
  BUDGETS_VIEW = 'budgets:view',
  BUDGETS_CREATE = 'budgets:create',
  BUDGETS_UPDATE = 'budgets:update',
  BUDGETS_DELETE = 'budgets:delete',
  BUDGETS_SHARE = 'budgets:share',

  // Medical history (allergies, medication, conditions, surgeries, notes).
  // Deliberately separate from PATIENTS_*: STAFF holds PATIENTS_VIEW, and
  // reusing it would hand every receptionist every patient's clinical data.
  MEDICAL_HISTORY_VIEW = 'medical_history:view',
  MEDICAL_HISTORY_UPDATE = 'medical_history:update',
}

/**
 * Mapping of roles to their permissions
 *
 * STAFF: Read-only access to most resources
 * DOCTOR: STAFF + can edit dental charts and view statistics
 * CLINIC_ADMIN: Full CRUD on operational resources (patients, appointments, doctors, labworks, expenses) but no user management, settings updates, or data export
 * ADMIN: Full operational control except tenant profile, billing, and owner promotion
 * OWNER: Complete access to everything
 */
// Define base permissions for each role
const STAFF_PERMISSIONS = [
  // View only
  Permission.PATIENTS_VIEW,
  Permission.APPOINTMENTS_VIEW,
  Permission.DOCTORS_VIEW,
  Permission.LABWORKS_VIEW,
  Permission.EXPENSES_VIEW,
  Permission.PAYMENTS_VIEW,
  Permission.BUDGETS_VIEW,
  Permission.DENTAL_CHARTS_VIEW,
  Permission.SETTINGS_VIEW,
  Permission.USERS_VIEW,
  Permission.ATTACHMENTS_VIEW,
];

const CLINIC_ADMIN_PERMISSIONS = [
  // Full CRUD on operational resources
  Permission.PATIENTS_VIEW,
  Permission.PATIENTS_CREATE,
  Permission.PATIENTS_UPDATE,
  Permission.PATIENTS_DELETE,

  Permission.APPOINTMENTS_VIEW,
  Permission.APPOINTMENTS_CREATE,
  Permission.APPOINTMENTS_UPDATE,
  Permission.APPOINTMENTS_DELETE,

  Permission.DOCTORS_VIEW,
  Permission.DOCTORS_CREATE,
  Permission.DOCTORS_UPDATE,
  Permission.DOCTORS_DELETE,

  Permission.LABWORKS_VIEW,
  Permission.LABWORKS_CREATE,
  Permission.LABWORKS_UPDATE,
  Permission.LABWORKS_DELETE,

  Permission.EXPENSES_VIEW,
  Permission.EXPENSES_CREATE,
  Permission.EXPENSES_UPDATE,
  Permission.EXPENSES_DELETE,

  Permission.PAYMENTS_VIEW,
  Permission.PAYMENTS_CREATE,
  Permission.PAYMENTS_DELETE,

  Permission.BUDGETS_VIEW,
  Permission.BUDGETS_CREATE,
  Permission.BUDGETS_UPDATE,
  Permission.BUDGETS_DELETE,
  Permission.BUDGETS_SHARE,

  // View-only for users and settings
  Permission.USERS_VIEW,
  Permission.SETTINGS_VIEW,

  // Dental charts
  Permission.DENTAL_CHARTS_VIEW,
  Permission.DENTAL_CHARTS_UPDATE,

  // Statistics
  Permission.STATISTICS_VIEW,

  // Attachments
  Permission.ATTACHMENTS_VIEW,
  Permission.ATTACHMENTS_UPLOAD,
  Permission.ATTACHMENTS_DELETE,

  Permission.MEDICAL_HISTORY_VIEW,
  Permission.MEDICAL_HISTORY_UPDATE,
];

const ADMIN_PERMISSIONS = [
  // Full CRUD on operational resources
  Permission.PATIENTS_VIEW,
  Permission.PATIENTS_CREATE,
  Permission.PATIENTS_UPDATE,
  Permission.PATIENTS_DELETE,

  Permission.APPOINTMENTS_VIEW,
  Permission.APPOINTMENTS_CREATE,
  Permission.APPOINTMENTS_UPDATE,
  Permission.APPOINTMENTS_DELETE,

  Permission.DOCTORS_VIEW,
  Permission.DOCTORS_CREATE,
  Permission.DOCTORS_UPDATE,
  Permission.DOCTORS_DELETE,

  Permission.LABWORKS_VIEW,
  Permission.LABWORKS_CREATE,
  Permission.LABWORKS_UPDATE,
  Permission.LABWORKS_DELETE,

  Permission.EXPENSES_VIEW,
  Permission.EXPENSES_CREATE,
  Permission.EXPENSES_UPDATE,
  Permission.EXPENSES_DELETE,

  Permission.PAYMENTS_VIEW,
  Permission.PAYMENTS_CREATE,
  Permission.PAYMENTS_DELETE,

  Permission.BUDGETS_VIEW,
  Permission.BUDGETS_CREATE,
  Permission.BUDGETS_UPDATE,
  Permission.BUDGETS_DELETE,
  Permission.BUDGETS_SHARE,

  Permission.USERS_VIEW,
  Permission.USERS_CREATE,
  Permission.USERS_UPDATE,
  Permission.USERS_DELETE,

  Permission.DENTAL_CHARTS_VIEW,
  Permission.DENTAL_CHARTS_UPDATE,

  Permission.STATISTICS_VIEW,

  Permission.SETTINGS_VIEW,
  Permission.SETTINGS_UPDATE,

  Permission.DATA_EXPORT,

  Permission.ATTACHMENTS_VIEW,
  Permission.ATTACHMENTS_UPLOAD,
  Permission.ATTACHMENTS_DELETE,

  Permission.MEDICAL_HISTORY_VIEW,
  Permission.MEDICAL_HISTORY_UPDATE,
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [], // Super admin has no tenant-specific permissions (uses separate routes)

  STAFF: STAFF_PERMISSIONS,

  DOCTOR: [
    // All STAFF permissions
    ...STAFF_PERMISSIONS,
    // Plus editing dental charts, viewing statistics, and uploading attachments
    Permission.DENTAL_CHARTS_UPDATE,
    Permission.STATISTICS_VIEW,
    Permission.ATTACHMENTS_UPLOAD,
    // Doctors typically build and adjust the patient's treatment plan (budget)
    Permission.BUDGETS_CREATE,
    Permission.BUDGETS_UPDATE,
    // Clinical data: doctors read and record it. STAFF does not (see enum note).
    Permission.MEDICAL_HISTORY_VIEW,
    Permission.MEDICAL_HISTORY_UPDATE,
  ],

  CLINIC_ADMIN: CLINIC_ADMIN_PERMISSIONS,

  ADMIN: ADMIN_PERMISSIONS,

  OWNER: [
    // All ADMIN permissions
    ...ADMIN_PERMISSIONS,
    // Plus exclusive owner permissions
    Permission.USERS_PROMOTE_OWNER,
    Permission.TENANT_PROFILE_UPDATE,
    Permission.TENANT_DELETE,
    Permission.BILLING_VIEW,
    Permission.BILLING_MANAGE,
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
