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
  setupPin: (userId: string, pin: string) => Promise<void>
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
        set((state) => ({
          profileToken: response.profileToken,
          activeUser: response.user,
          isLocked: false,
          profiles: state.profiles.map((p) =>
            p.id === userId ? { ...p, hasPinSet: true } : p
          ),
        }))
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
    }
  )
)
