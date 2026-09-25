/**
 * Task #431 — the kiosk used to offer PIN provisioning to sessions that
 * cannot perform it, then, on the inevitable 403, told the operator to try
 * again. Two defences are asserted here:
 *
 *  1. pre-routing — a profile the server marked `canSetupPin: false` never
 *     reaches a PIN keypad at all;
 *  2. the 403 landing — if the attempt happens anyway (stale list, race, an
 *     API that predates the flag), the refusal is terminal and explained,
 *     not a retry prompt.
 *
 * The lock store is the REAL one throughout, with only `@/lib/api` mocked:
 * `lock.store.setupPin` awaits the HTTP call before any `set()`, so "the
 * store is untouched by a rejected setup" is a property to observe, not a
 * diff to write. Mocking the store would have hidden it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AxiosError, AxiosHeaders } from 'axios'

// Return the key so assertions are locale-independent; the actual copy is
// pinned by src/i18n/task-431-pin-provision-not-allowed-keys.test.ts.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', () => ({
  authApi: {
    getProfiles: vi.fn(),
    pinLogin: vi.fn(),
    setupPin: vi.fn(),
    logout: vi.fn(),
  },
}))

import { authApi } from '@/lib/api'
import type { ProfileUser } from '@/lib/api'
import { useLockStore } from '@/stores/lock.store'
import { LockScreen } from './LockScreen'

const blockedProfile: ProfileUser = {
  id: 'u-blocked',
  firstName: 'Blocked',
  lastName: 'Person',
  role: 'OWNER',
  avatar: null,
  hasPinSet: false,
  canSetupPin: false,
}

const allowedProfile: ProfileUser = {
  id: 'u-allowed',
  firstName: 'Allowed',
  lastName: 'Person',
  role: 'STAFF',
  avatar: null,
  hasPinSet: false,
  canSetupPin: true,
}

// An API that predates #431: the field is simply absent. The client must
// degrade to the previous behaviour (attempt, then handle the 403).
const staleApiProfile: ProfileUser = {
  id: 'u-stale',
  firstName: 'Stale',
  lastName: 'Person',
  role: 'STAFF',
  avatar: null,
  hasPinSet: false,
}

const enrolledProfile: ProfileUser = {
  id: 'u-enrolled',
  firstName: 'Enrolled',
  lastName: 'Person',
  role: 'DOCTOR',
  avatar: null,
  hasPinSet: true,
  canSetupPin: false,
}

function axiosErrorWithStatus(status: number, code?: string) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data: code ? { success: false, error: { message: 'Insufficient permissions', code } } : {},
      status,
      statusText: 'Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
    } as never
  )
}

function pinInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
}

/** Types four digits; the component auto-submits on the fourth. */
function typePin(digits: string) {
  const inputs = pinInputs()
  expect(inputs, 'expected a 4-box PIN keypad').toHaveLength(4)
  for (let i = 0; i < 4; i++) {
    fireEvent.change(inputs[i], { target: { value: digits[i] } })
  }
}

async function renderLockScreen(profiles: ProfileUser[]) {
  vi.mocked(authApi.getProfiles).mockResolvedValue(profiles)
  const view = render(
    <MemoryRouter>
      <LockScreen />
    </MemoryRouter>
  )
  if (profiles.length > 0) {
    await screen.findByText(`${profiles[0].firstName} ${profiles[0].lastName}`)
  }
  return view
}

function selectProfile(profile: ProfileUser) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`${profile.firstName} ${profile.lastName}`) })
  )
}

describe('LockScreen (task #431)', () => {
  beforeEach(() => {
    useLockStore.getState().reset()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.mocked(authApi.getProfiles).mockResolvedValue([])
  })

  describe('profile selection routing', () => {
    it('sends a profile the server marked canSetupPin:false to the unavailable step, with no keypad', async () => {
      await renderLockScreen([blockedProfile])

      selectProfile(blockedProfile)

      expect(screen.getByText('pin.provisionNotAllowed')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(0)
      expect(screen.queryByText('pin.enterNew')).not.toBeInTheDocument()
      expect(screen.queryByText('pin.setupDescription')).not.toBeInTheDocument()
      expect(screen.queryByText('pin.startOver')).not.toBeInTheDocument()
      // The way back is the only affordance offered.
      expect(screen.getByRole('button', { name: 'common.back' })).toBeInTheDocument()
    })

    it('sends a profile with canSetupPin:true to the PIN setup keypad', async () => {
      await renderLockScreen([allowedProfile])

      selectProfile(allowedProfile)

      expect(screen.getByText('pin.enterNew')).toBeInTheDocument()
      expect(screen.getByText('pin.setupDescription')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(4)
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
    })

    it('treats a missing canSetupPin (API predating #431) as permitted rather than blocked', async () => {
      await renderLockScreen([staleApiProfile])

      selectProfile(staleApiProfile)

      expect(screen.getByText('pin.enterNew')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(4)
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
    })

    it('still asks for the existing PIN when the profile has one, even with canSetupPin:false', async () => {
      await renderLockScreen([enrolledProfile])

      selectProfile(enrolledProfile)

      expect(screen.getByText('lock.enterPin')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(4)
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
    })

    it('still walks an allowed caller provisioning someone else through to the enter-PIN prompt', async () => {
      // No profileToken in the response: the backend withholds it when an
      // ADMIN provisions another user, so the device stays locked.
      vi.mocked(authApi.setupPin).mockResolvedValue({
        user: { ...allowedProfile, hasPinSet: true },
      })
      await renderLockScreen([allowedProfile])

      selectProfile(allowedProfile)
      typePin('1234')
      await waitFor(() => expect(screen.getByText('pin.confirmPin')).toBeInTheDocument())
      typePin('1234')

      await waitFor(() =>
        expect(screen.getByText('pin.provisionedEnterToContinue')).toBeInTheDocument()
      )
      expect(vi.mocked(authApi.setupPin)).toHaveBeenCalledWith({
        userId: allowedProfile.id,
        pin: '1234',
      })
      expect(screen.getByText('lock.enterPin')).toBeInTheDocument()
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
    })
  })

  describe('403 FORBIDDEN from setup-pin', () => {
    it('lands on the explained dead end instead of the retry prompt, and leaves the lock store untouched', async () => {
      vi.mocked(authApi.setupPin).mockRejectedValue(axiosErrorWithStatus(403, 'FORBIDDEN'))
      // The stale-list case: the row says provisioning is possible, the
      // server disagrees.
      await renderLockScreen([staleApiProfile])
      useLockStore.setState({ isLocked: true })
      const before = useLockStore.getState()
      const profilesBefore = before.profiles

      selectProfile(staleApiProfile)
      typePin('5678')
      await waitFor(() => expect(screen.getByText('pin.confirmPin')).toBeInTheDocument())
      typePin('5678')

      await waitFor(() => expect(screen.getByText('pin.provisionNotAllowed')).toBeInTheDocument())
      expect(vi.mocked(authApi.setupPin)).toHaveBeenCalledTimes(1)

      // No retry path is offered, in any shape.
      expect(screen.queryByText('pin.saveError')).not.toBeInTheDocument()
      expect(screen.queryByText('pin.startOver')).not.toBeInTheDocument()
      expect(screen.queryByText('pin.enterNew')).not.toBeInTheDocument()
      expect(screen.queryByText('pin.confirmPin')).not.toBeInTheDocument()
      expect(pinInputs()).toHaveLength(0)

      // The rejected call must not have moved the session an inch.
      const after = useLockStore.getState()
      expect(after.profiles).toEqual(profilesBefore)
      expect(after.profiles.find((p) => p.id === staleApiProfile.id)?.hasPinSet).toBe(false)
      expect(after.profileToken).toBeNull()
      expect(after.activeUser).toBeNull()
      expect(after.isLocked).toBe(true)
    })

    it('keeps the old retry path for a non-403 failure, so the new branch is discriminating', async () => {
      vi.mocked(authApi.setupPin).mockRejectedValue(axiosErrorWithStatus(500))
      await renderLockScreen([allowedProfile])

      selectProfile(allowedProfile)
      typePin('4321')
      await waitFor(() => expect(screen.getByText('pin.confirmPin')).toBeInTheDocument())
      typePin('4321')

      await waitFor(() => expect(screen.getByText('pin.saveError')).toBeInTheDocument())
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
      // Back on the setup keypad, ready for another attempt.
      expect(screen.getByText('pin.enterNew')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(4)
    })

    it('treats a 403 that is not FORBIDDEN (expired profile token) as a retryable error', async () => {
      vi.mocked(authApi.setupPin).mockRejectedValue(
        axiosErrorWithStatus(403, 'PROFILE_TOKEN_EXPIRED')
      )
      await renderLockScreen([allowedProfile])

      selectProfile(allowedProfile)
      typePin('1111')
      await waitFor(() => expect(screen.getByText('pin.confirmPin')).toBeInTheDocument())
      typePin('1111')

      await waitFor(() => expect(screen.getByText('pin.saveError')).toBeInTheDocument())
      expect(screen.queryByText('pin.provisionNotAllowed')).not.toBeInTheDocument()
    })
  })

  describe('profile list refetch on mount', () => {
    it('refetches even when the store already holds a non-empty list, and renders the fresh rows', async () => {
      // A list prefetched under a profile token carries that profile's
      // authority in canSetupPin; the base session is what will call
      // setup-pin now, so the stale list must not be trusted.
      useLockStore.setState({ profiles: [{ ...allowedProfile, firstName: 'Cached' }] })
      vi.mocked(authApi.getProfiles).mockResolvedValue([blockedProfile])

      render(
        <MemoryRouter>
          <LockScreen />
        </MemoryRouter>
      )

      await waitFor(() =>
        expect(
          vi.mocked(authApi.getProfiles),
          'LockScreen skipped the refetch because the store list was non-empty'
        ).toHaveBeenCalledTimes(1)
      )
      await screen.findByText('Blocked Person')
      expect(screen.getByText('Blocked Person')).toBeInTheDocument()
      expect(screen.queryByText('Cached Person')).not.toBeInTheDocument()
      expect(useLockStore.getState().profiles).toEqual([blockedProfile])
    })

    // Task #484 — the mount refetch above is unconditional by design, so
    // every lock event re-runs a request that can fail. It used to wipe the
    // list into an empty <div>: no message, no retry, and `profiles` is not
    // persisted, so a page reload did not bring it back either.
    it('keeps every retained profile card on screen and offers an enabled retry when the mount refetch fails', async () => {
      useLockStore.setState({ profiles: [enrolledProfile, allowedProfile] })
      vi.mocked(authApi.getProfiles).mockRejectedValue(new Error('Network Error'))

      render(
        <MemoryRouter>
          <LockScreen />
        </MemoryRouter>
      )

      await screen.findByText('lock.profilesError')
      // Every card, not just the first one.
      expect(screen.getByText('Enrolled Person')).toBeInTheDocument()
      expect(screen.getByText('Allowed Person')).toBeInTheDocument()
      const retry = screen.getByRole('button', { name: 'lock.retry' })
      expect(retry).toBeEnabled()
      expect(useLockStore.getState().profiles).toEqual([enrolledProfile, allowedProfile])
    })

    it('shows the notice and a retry control instead of a blank grid when the store was empty', async () => {
      vi.mocked(authApi.getProfiles).mockRejectedValue(new Error('Network Error'))

      render(
        <MemoryRouter>
          <LockScreen />
        </MemoryRouter>
      )

      await screen.findByText('lock.profilesError')
      expect(screen.getByRole('button', { name: 'lock.retry' })).toBeEnabled()
      // The old behaviour: nothing at all to act on but "full logout".
      expect(screen.queryByText('Enrolled Person')).not.toBeInTheDocument()
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    })

    it('re-requests the profiles when the retry control is clicked, and clears the notice on success', async () => {
      vi.mocked(authApi.getProfiles)
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockResolvedValue([enrolledProfile])

      render(
        <MemoryRouter>
          <LockScreen />
        </MemoryRouter>
      )

      await screen.findByText('lock.profilesError')
      expect(vi.mocked(authApi.getProfiles)).toHaveBeenCalledTimes(1)

      // Driven through the UI, not by calling the store.
      fireEvent.click(screen.getByRole('button', { name: 'lock.retry' }))

      await waitFor(() => expect(vi.mocked(authApi.getProfiles)).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(screen.queryByText('lock.profilesError')).not.toBeInTheDocument()
      )
      expect(screen.getByText('Enrolled Person')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'lock.retry' })).not.toBeInTheDocument()
      expect(useLockStore.getState().profilesError).toBe(false)
    })

    // The approved variant shows the retained rows but forbids acting on
    // them: a retained row can carry `canSetupPin`/`hasPinSet` computed under
    // a different session, and a click would route the operator on that stale
    // authority. This asserts the click is INERT — not merely that the
    // attribute is present, which a CSS-only fake would satisfy.
    it('does not let a retained profile be selected while the refetch is failing, and restores selection after a successful retry', async () => {
      useLockStore.setState({ profiles: [enrolledProfile] })
      vi.mocked(authApi.getProfiles)
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockResolvedValue([enrolledProfile])

      render(
        <MemoryRouter>
          <LockScreen />
        </MemoryRouter>
      )

      await screen.findByText('lock.profilesError')

      selectProfile(enrolledProfile)

      // enrolledProfile.hasPinSet === true, so a click that got through
      // would have swapped the grid for the 4-box PIN keypad.
      expect(pinInputs()).toHaveLength(0)
      expect(screen.queryByText('lock.enterPin')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.back' })).not.toBeInTheDocument()
      // Still on the grid, still explaining why.
      expect(screen.getByText('lock.profilesError')).toBeInTheDocument()
      expect(screen.getByText('Enrolled Person')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'lock.retry' }))
      await waitFor(() =>
        expect(screen.queryByText('lock.profilesError')).not.toBeInTheDocument()
      )

      // Same row, same profile, now actionable.
      selectProfile(enrolledProfile)
      expect(screen.getByText('lock.enterPin')).toBeInTheDocument()
      expect(pinInputs()).toHaveLength(4)
    })
  })
})
