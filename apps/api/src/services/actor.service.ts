import { prisma } from '@dental/database'

/*
 * Task #461: turn a recorded actor id into something a screen can show.
 *
 * An actor id is a plain column with no relation (an audit row must outlive the
 * user it names), so it cannot be joined. And it is not always a user id. Every
 * value it can hold has to render distinctly, because each one says something
 * different about what is known:
 *
 *   an existing, active user   -> their name
 *   an existing, deactivated   -> their name, marked deactivated. Tenant user
 *                                 deletion is soft, so the row and name remain.
 *   no such row in the tenant  -> "removed". A hard delete leaves the id behind
 *                                 and takes the name with it.
 *   a `system:` value          -> the system. No person did this.
 *   null                       -> nothing. The actor was never recorded, and a
 *                                 placeholder would read as a record.
 *
 * A PIN profile is not a separate case: profile users are ordinary rows, and
 * writers record profileUserId || userId, so they resolve like any user. Their
 * placeholder email is never part of the result.
 */

export type ActorView =
  | { kind: 'user'; name: string; active: boolean }
  | { kind: 'removed' }
  | { kind: 'system' }

/** The prefix that marks work no person did (see SYSTEM_ACTOR_BACKFILL_406). */
const SYSTEM_ACTOR_PREFIX = 'system:'

/**
 * Resolve many actor ids with a single query. The lookup is scoped to the
 * tenant: an id that belongs to another tenant resolves as `removed`, never as
 * that user's name.
 *
 * Returns a function rather than a map so callers cannot forget the null and
 * `system:` cases, which never reach the database.
 */
export async function resolveActors(
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>
): Promise<(id: string | null | undefined) => ActorView | null> {
  const userIds = [
    ...new Set(ids.filter((id): id is string => !!id && !id.startsWith(SYSTEM_ACTOR_PREFIX))),
  ]

  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { tenantId, id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, isActive: true },
        })
  const byId = new Map(users.map((u) => [u.id, u]))

  return (id) => {
    if (!id) return null
    if (id.startsWith(SYSTEM_ACTOR_PREFIX)) return { kind: 'system' }
    const user = byId.get(id)
    if (!user) return { kind: 'removed' }
    return { kind: 'user', name: `${user.firstName} ${user.lastName}`.trim(), active: user.isActive }
  }
}
