import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// recalc-paid-status.ts runs its work at module top-level (it is a CLI
// script, not a library of exported functions), so these tests drive it by
// mocking its two dependencies and importing the module fresh per test —
// there is nothing else to call.
vi.mock('@dental/database', () => ({
  prisma: {
    patientPayment: {
      groupBy: vi.fn(),
    },
  },
  disconnectDatabase: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/payment.service.js', () => ({
  recalculatePaidStatus: vi.fn(),
}))

import { prisma, disconnectDatabase } from '@dental/database'
import { recalculatePaidStatus } from '../services/payment.service.js'

const mockGroupBy = vi.mocked(prisma.patientPayment.groupBy)
const mockDisconnect = vi.mocked(disconnectDatabase)
const mockRecalculate = vi.mocked(recalculatePaidStatus)

describe('recalc-paid-status script exit code', () => {
  let originalExitCode: number | string | undefined | null
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // process.exitCode is a shared, mutable global — this whole vitest
    // worker (singleFork: true in vitest.config.ts) reports its own exit
    // status from it, so a test that sets it to 1 and never restores it
    // would poison every other test file's reported result.
    originalExitCode = process.exitCode
    process.exitCode = undefined
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('sets a non-zero exit code when at least one (tenant, patient) pair throws', async () => {
    mockGroupBy.mockResolvedValue([
      { tenantId: 't1', patientId: 'p1' },
      { tenantId: 't1', patientId: 'p2' },
    ] as never)
    mockRecalculate
      .mockResolvedValueOnce({ appointmentChanges: 1, labworkChanges: 0 })
      .mockRejectedValueOnce(new Error('boom: simulated per-patient failure'))

    await import('./recalc-paid-status.js')
    await vi.waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1))

    expect(mockRecalculate).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBe(1)
  })

  it('leaves the exit code untouched when every pair processes without error', async () => {
    mockGroupBy.mockResolvedValue([
      { tenantId: 't1', patientId: 'p1' },
      { tenantId: 't1', patientId: 'p2' },
    ] as never)
    mockRecalculate.mockResolvedValue({ appointmentChanges: 0, labworkChanges: 0 })

    await import('./recalc-paid-status.js')
    await vi.waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1))

    expect(mockRecalculate).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBeUndefined()
  })

  it('sets a non-zero exit code even when every pair errors (all-failure path)', async () => {
    mockGroupBy.mockResolvedValue([{ tenantId: 't1', patientId: 'p1' }] as never)
    mockRecalculate.mockRejectedValue(new Error('boom'))

    await import('./recalc-paid-status.js')
    await vi.waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1))

    expect(process.exitCode).toBe(1)
  })
})
