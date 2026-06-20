import { prisma } from '@dental/database'

// Default business hours (Mon-Fri 9:00-18:00)
const DEFAULT_BUSINESS_HOURS = {
  1: { start: '09:00', end: '18:00' }, // Monday
  2: { start: '09:00', end: '18:00' }, // Tuesday
  3: { start: '09:00', end: '18:00' }, // Wednesday
  4: { start: '09:00', end: '18:00' }, // Thursday
  5: { start: '09:00', end: '18:00' }, // Friday
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] // Mon-Fri

export interface TenantSettingsInput {
  language?: string
  dateFormat?: string
  timeFormat?: string
  defaultAppointmentDuration?: number
  appointmentBuffer?: number
  businessHours?: Record<number, { start: string; end: string }>
  workingDays?: number[]
  emailNotifications?: boolean
  smsNotifications?: boolean
  appointmentReminders?: boolean
  reminderHoursBefore?: number
  autoLockMinutes?: number
}

export const TenantSettingsService = {
  /**
   * Get settings for a tenant
   */
  async getSettings(tenantId: string) {
    return prisma.tenantSettings.findUnique({
      where: { tenantId },
    })
  },

  /**
   * Create default settings for a new tenant
   */
  async createDefaultSettings(tenantId: string) {
    return prisma.tenantSettings.create({
      data: {
        tenantId,
        businessHours: DEFAULT_BUSINESS_HOURS,
        workingDays: DEFAULT_WORKING_DAYS,
      },
    })
  },

  /**
   * Update settings for a tenant
   */
  async updateSettings(tenantId: string, data: TenantSettingsInput) {
    // Ensure settings exist
    const existing = await this.getSettings(tenantId)

    if (!existing) {
      // Create with provided data
      return prisma.tenantSettings.create({
        data: {
          tenantId,
          ...data,
          businessHours: data.businessHours ?? DEFAULT_BUSINESS_HOURS,
          workingDays: data.workingDays ?? DEFAULT_WORKING_DAYS,
        },
      })
    }

    // Update existing settings
    return prisma.tenantSettings.update({
      where: { tenantId },
      data: {
        ...(data.language !== undefined && { language: data.language }),
        ...(data.dateFormat !== undefined && { dateFormat: data.dateFormat }),
        ...(data.timeFormat !== undefined && { timeFormat: data.timeFormat }),
        ...(data.defaultAppointmentDuration !== undefined && {
          defaultAppointmentDuration: data.defaultAppointmentDuration,
        }),
        ...(data.appointmentBuffer !== undefined && {
          appointmentBuffer: data.appointmentBuffer,
        }),
        ...(data.businessHours !== undefined && { businessHours: data.businessHours }),
        ...(data.workingDays !== undefined && { workingDays: data.workingDays }),
        ...(data.emailNotifications !== undefined && {
          emailNotifications: data.emailNotifications,
        }),
        ...(data.smsNotifications !== undefined && {
          smsNotifications: data.smsNotifications,
        }),
        ...(data.appointmentReminders !== undefined && {
          appointmentReminders: data.appointmentReminders,
        }),
        ...(data.reminderHoursBefore !== undefined && {
          reminderHoursBefore: data.reminderHoursBefore,
        }),
        ...(data.autoLockMinutes !== undefined && {
          autoLockMinutes: data.autoLockMinutes,
        }),
      },
    })
  },

  /**
   * Get or create settings (upsert pattern)
   */
  async getOrCreateSettings(tenantId: string) {
    const settings = await this.getSettings(tenantId)
    if (settings) return settings
    return this.createDefaultSettings(tenantId)
  },
}
