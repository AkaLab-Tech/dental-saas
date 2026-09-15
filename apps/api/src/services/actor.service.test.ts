import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@dental/database', () => ({
  prisma: { user: { findMany: vi.fn() } },
}))

import { prisma } from '@dental/database'
import { resolveActors } from './actor.service.js'

const findMany = vi.mocked(prisma.user.findMany)

beforeEach(() => {
  findMany.mockReset()
})

describe('resolveActors', () => {
  it('renders an existing active user as their name', async () => {
    findMany.mockResolvedValue([{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', isActive: true }] as never)

    const actor = await resolveActors('t1', ['u1'])

    expect(actor('u1')).toEqual({ kind: 'user', name: 'Ana Pérez', active: true })
  })

  it('keeps the name of a deactivated user and marks them inactive', async () => {
    findMany.mockResolvedValue([{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', isActive: false }] as never)

    const actor = await resolveActors('t1', ['u1'])

    expect(actor('u1')).toEqual({ kind: 'user', name: 'Ana Pérez', active: false })
  })

  it('resolves an id with no row as removed, never as null', async () => {
    findMany.mockResolvedValue([] as never)

    const actor = await resolveActors('t1', ['gone'])

    expect(actor('gone')).toEqual({ kind: 'removed' })
  })

  it('resolves a system: value as the system without querying for it', async () => {
    const actor = await resolveActors('t1', ['system:backfill-406'])

    expect(actor('system:backfill-406')).toEqual({ kind: 'system' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('resolves a missing actor as null, distinct from removed', async () => {
    const actor = await resolveActors('t1', [null, undefined])

    expect(actor(null)).toBeNull()
    expect(actor(undefined)).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('looks up distinct user ids once, scoped to the tenant', async () => {
    findMany.mockResolvedValue([] as never)

    await resolveActors('t1', ['u1', 'u2', 'u1', null, 'system:x'])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', id: { in: ['u1', 'u2'] } } })
    )
  })

  it('never exposes an email, so a PIN profile placeholder address cannot leak', async () => {
    findMany.mockResolvedValue([{ id: 'p1', firstName: 'Pedro', lastName: 'Perfil', isActive: true }] as never)

    const actor = await resolveActors('t1', ['p1'])

    expect(findMany.mock.calls[0][0]).not.toHaveProperty('select.email')
    expect(JSON.stringify(actor('p1'))).not.toContain('@')
  })
})
