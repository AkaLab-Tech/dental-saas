import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserRole } from '@dental/shared'
import { useLockStore } from './lock.store'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Exclude<UserRole, 'SUPER_ADMIN'>
  tenantId: string
  avatar?: string
  phone?: string
  hasPinSet?: boolean
  tenant?: {
    id: string
    name: string
    slug: string
    logo?: string
    currency?: string
  }
}

export interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface AuthActions {
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
  clearError: () => void
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      ...initialState,

      setAuth: (user, accessToken, refreshToken) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        }),

      setTokens: (accessToken, refreshToken) =>
        set({
          accessToken,
          refreshToken,
        }),

      setUser: (user) =>
        set({
          user,
        }),

      setLoading: (isLoading) =>
        set({
          isLoading,
        }),

      setError: (error) =>
        set({
          error,
          isLoading: false,
        }),

      logout: () => {
        // Reset the kiosk lock store too. Otherwise the profile token and
        // activeUser persisted under `dental-lock` survive logout and leak into
        // the next user's session on a shared device (privilege escalation).
        useLockStore.getState().reset()
        set({
          ...initialState,
        })
      },

      clearError: () =>
        set({
          error: null,
        }),
    }),
    {
      name: 'dental-auth',
      // NOTE: Tokens are stored in sessionStorage, which is cleared when the tab is closed.
      // Access tokens in Web Storage remain vulnerable to XSS; for stronger protection,
      // consider storing refresh tokens in httpOnly cookies managed by the backend.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
