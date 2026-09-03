import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { authApi } from '@/lib/api'
import type { ProfileUser } from '@/lib/api'

export interface LockState {
  isLocked: boolean
  autoLockMinutes: number
  profiles: ProfileUser[]
  profileToken: string | null
  activeUser: ProfileUser | null
}

export interface LockActions {
  lock: () => void
  unlock: () => void
  setAutoLockMinutes: (minutes: number) => void
  fetchProfiles: () => Promise<void>
  pinLogin: (userId: string, pin: string) => Promise<void>
  /** Returns true when the caller set up their own PIN (session unlocked with a fresh token). */
  setupPin: (userId: string, pin: string) => Promise<boolean>
  reset: () => void
}

const initialState: LockState = {
  isLocked: false,
  autoLockMinutes: 5,
  profiles: [],
  profileToken: null,
  activeUser: null,
}

export const useLockStore = create<LockState & LockActions>()(
  persist(
    (set) => ({
      ...initialState,

      lock: () => set({ isLocked: true, profileToken: null, activeUser: null }),

      unlock: () => set({ isLocked: false }),

      setAutoLockMinutes: (minutes) => set({ autoLockMinutes: minutes }),

      fetchProfiles: async () => {
        try {
          const profiles = await authApi.getProfiles()
          set({ profiles })
        } catch {
          set({ profiles: [] })
        }
      },

      pinLogin: async (userId, pin) => {
        const response = await authApi.pinLogin({ userId, pin })
        set((state) => ({
          profileToken: response.profileToken,
          activeUser: response.user,
          isLocked: false,
          profiles: state.profiles.map((p) =>
            p.id === userId ? { ...p, hasPinSet: true } : p
          ),
        }))
      },

      setupPin: async (userId, pin) => {
        const response = await authApi.setupPin({ userId, pin })
        // profileToken is only present for self-service setup. When an
        // ADMIN provisions someone else's PIN, the backend withholds the
        // token on purpose — the session must stay locked, the admin's own
        // token/identity must not be touched, and the caller must fall back
        // to the ordinary pin-login flow to obtain a session for that user.
        if (response.profileToken) {
          set((state) => ({
            profileToken: response.profileToken,
            activeUser: response.user,
            isLocked: false,
            profiles: state.profiles.map((p) =>
              p.id === userId ? { ...p, hasPinSet: true } : p
            ),
          }))
          return true
        }
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === userId ? { ...p, hasPinSet: true } : p
          ),
        }))
        return false
      },

      reset: () => set({ ...initialState }),
    }),
    {
      name: 'dental-lock',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        isLocked: state.isLocked,
        autoLockMinutes: state.autoLockMinutes,
        profileToken: state.profileToken,
        activeUser: state.activeUser,
      }),
      // Invariant: activeUser !== null REQUIRES a non-empty profileToken.
      // A tokenless store carries only base-session authority (lib/api.ts
      // attaches X-Profile-Token only when truthy), so it is not an elevated
      // state on its own — isLocked is left untouched here. What must be
      // forbidden is a persisted payload claiming to be switched into a
      // profile (activeUser set) with no credential behind it.
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<LockState>),
        }
        if (merged.activeUser && !merged.profileToken) {
          return { ...merged, activeUser: null, profileToken: null }
        }
        return merged
      },
    }
  )
)
