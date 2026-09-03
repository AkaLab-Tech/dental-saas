import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLockStore } from './lock.store'
import type { ProfileUser } from '@/lib/api'

// Mock the api module the way settings.store.test.ts / labworks.store.test.ts do:
// mock the module, then import the mocked named export to drive assertions.
vi.mock('@/lib/api', () => ({
  authApi: {
    getProfiles: vi.fn(),
    pinLogin: vi.fn(),
    setupPin: vi.fn(),
  },
}))

import { authApi } from '@/lib/api'

const STORAGE_KEY = 'dental-lock'

const staffProfile: ProfileUser = {
  id: 'user-staff',
  firstName: 'Staff',
  lastName: 'User',
  role: 'STAFF',
  avatar: null,
  hasPinSet: false,
}

const ownerProfile: ProfileUser = {
  id: 'user-owner',
  firstName: 'Owner',
  lastName: 'User',
  role: 'OWNER',
  avatar: null,
  hasPinSet: true,
}

describe('lock.store', () => {
  beforeEach(() => {
    // Reset to the store's own initial state (keeps actions intact) rather
    // than reaching into internals.
    useLockStore.getState().reset()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  describe('setupPin', () => {
    it('does not unlock the session when the response has no profileToken (ADMIN provisioning someone else)', async () => {
      useLockStore.setState({
        profiles: [staffProfile],
        profileToken: 'existing-token',
        activeUser: ownerProfile,
        isLocked: true,
      })
      vi.mocked(authApi.setupPin).mockResolvedValue({
        user: { ...staffProfile, hasPinSet: true },
      })

      const result = await useLockStore.getState().setupPin(staffProfile.id, '1234')

      expect(result).toBe(false)
      const state = useLockStore.getState()
      // The caller's own session must be completely unaffected by
      // provisioning someone else's PIN.
      expect(state.isLocked).toBe(true)
      expect(state.profileToken).toBe('existing-token')
      expect(state.activeUser).toEqual(ownerProfile)
      // But the provisioned profile's hasPinSet flag must flip so the UI
      // stops offering "set up PIN" for that user.
      expect(state.profiles.find((p) => p.id === staffProfile.id)?.hasPinSet).toBe(true)
    })

    it('unlocks and adopts the fresh profileToken when the response includes one (self-service)', async () => {
      useLockStore.setState({
        profiles: [staffProfile],
        profileToken: null,
        activeUser: null,
        isLocked: true,
      })
      const provisionedUser = { ...staffProfile, hasPinSet: true }
      vi.mocked(authApi.setupPin).mockResolvedValue({
        profileToken: 'fresh-token',
        user: provisionedUser,
      })

      const result = await useLockStore.getState().setupPin(staffProfile.id, '1234')

      expect(result).toBe(true)
      const state = useLockStore.getState()
      expect(state.profileToken).toBe('fresh-token')
      expect(state.activeUser).toEqual(provisionedUser)
      expect(state.isLocked).toBe(false)
      expect(state.profiles.find((p) => p.id === staffProfile.id)?.hasPinSet).toBe(true)
    })

    it('leaves the store completely untouched when setupPin rejects (regression guard: hasPinSet must only flip on the success path)', async () => {
      useLockStore.setState({
        profiles: [staffProfile],
        profileToken: 'existing-token',
        activeUser: ownerProfile,
        isLocked: true,
      })
      const forbidden = Object.assign(new Error('Forbidden'), {
        response: { status: 403, data: { error: { code: 'FORBIDDEN' } } },
      })
      vi.mocked(authApi.setupPin).mockRejectedValue(forbidden)

      await expect(
        useLockStore.getState().setupPin(staffProfile.id, '1234')
      ).rejects.toThrow('Forbidden')

      const state = useLockStore.getState()
      expect(state.isLocked).toBe(true)
      expect(state.profileToken).toBe('existing-token')
      expect(state.activeUser).toEqual(ownerProfile)
      // A profiles[] entry claiming a PIN that was never set would make the
      // next pin-login fail against a PIN nobody chose — this must never
      // happen on a failed request.
      expect(state.profiles).toEqual([staffProfile])
      expect(state.profiles.find((p) => p.id === staffProfile.id)?.hasPinSet).toBe(false)
    })
  })

  describe('persist merge / rehydration', () => {
    it('clears activeUser and profileToken on rehydrate when a persisted activeUser has no backing token', async () => {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          state: {
            isLocked: false,
            autoLockMinutes: 5,
            profileToken: null,
            activeUser: ownerProfile,
          },
          version: 0,
        })
      )

      await useLockStore.persist.rehydrate()

      const state = useLockStore.getState()
      expect(state.activeUser).toBeNull()
      expect(state.profileToken).toBeNull()
    })

    // This is the most important test in the file. An ordinary user who
    // never touches the kiosk/profile-switch flow persists exactly this
    // shape every session: locked=false, no token, no active profile. An
    // earlier draft of the merge guard bound the invariant to `isLocked`
    // itself and would have forced `isLocked: true` here whenever
    // activeUser/profileToken were absent. Since AppLayout.tsx:94 does an
    // unconditional `if (isLocked) return <LockScreen />`, that regression
    // would have greeted every non-kiosk user with a PIN prompt they never
    // set up. The guard must only ever clear activeUser/profileToken; it
    // must never flip isLocked on its own.
    it('rehydrates an ordinary tokenless session UNLOCKED (regression guard for AppLayout.tsx:94)', async () => {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          state: {
            isLocked: false,
            profileToken: null,
            activeUser: null,
            autoLockMinutes: 5,
          },
          version: 0,
        })
      )

      await useLockStore.persist.rehydrate()

      const state = useLockStore.getState()
      expect(state.isLocked).toBe(false)
      expect(state.profileToken).toBeNull()
      expect(state.activeUser).toBeNull()
    })

    it('rehydrates a valid persisted session (token + activeUser) unchanged', async () => {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          state: {
            isLocked: false,
            autoLockMinutes: 5,
            profileToken: 'valid-token',
            activeUser: ownerProfile,
          },
          version: 0,
        })
      )

      await useLockStore.persist.rehydrate()

      const state = useLockStore.getState()
      expect(state.profileToken).toBe('valid-token')
      expect(state.activeUser).toEqual(ownerProfile)
      expect(state.isLocked).toBe(false)
    })
  })

  describe('pinLogin', () => {
    it('sets profileToken, activeUser, unlocks, and marks the profile as having a PIN on success', async () => {
      useLockStore.setState({
        profiles: [staffProfile],
        profileToken: null,
        activeUser: null,
        isLocked: true,
      })
      const loggedInUser = { ...staffProfile, hasPinSet: true }
      vi.mocked(authApi.pinLogin).mockResolvedValue({
        profileToken: 'login-token',
        user: loggedInUser,
      })

      await useLockStore.getState().pinLogin(staffProfile.id, '1234')

      const state = useLockStore.getState()
      expect(state.profileToken).toBe('login-token')
      expect(state.activeUser).toEqual(loggedInUser)
      expect(state.isLocked).toBe(false)
      expect(state.profiles.find((p) => p.id === staffProfile.id)?.hasPinSet).toBe(true)
    })

    it('propagates the rejection and leaves the store untouched on an invalid PIN', async () => {
      useLockStore.setState({
        profiles: [staffProfile],
        profileToken: null,
        activeUser: null,
        isLocked: true,
      })
      const invalidCredentials = Object.assign(new Error('Invalid credentials'), {
        response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS' } } },
      })
      vi.mocked(authApi.pinLogin).mockRejectedValue(invalidCredentials)

      await expect(
        useLockStore.getState().pinLogin(staffProfile.id, '0000')
      ).rejects.toThrow('Invalid credentials')

      const state = useLockStore.getState()
      expect(state.isLocked).toBe(true)
      expect(state.profileToken).toBeNull()
      expect(state.activeUser).toBeNull()
    })
  })
})
