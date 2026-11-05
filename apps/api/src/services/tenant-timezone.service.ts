import { prisma } from '@dental/database'

/**
 * The tenant's IANA zone, for the calendar-day helpers in utils/zoned-day.ts. Kept out of that
 * module, which is deliberately Prisma-free. One indexed primary-key read per call.
 */
export async function getTenantTimezone(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  })
  return tenant?.timezone || 'UTC'
}
