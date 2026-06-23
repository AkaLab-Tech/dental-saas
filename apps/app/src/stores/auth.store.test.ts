import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore, type User } from './auth.store'
import { useLockStore } from './lock.store'

// Mock sessionStorage
const mockSessionStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
})

const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'ADMIN',
  tenantId: 'tenant-456',
  phone: '+1234567890',
  tenant: {
    id: 'tenant-456',
    name: 'Test Clinic',
    slug: 'test-clinic',
    logo: 'https://example.com/logo.png',
  },
}

const mockAccessToken = 'mock-access-token-xyz'
const mockRefreshToken = 'mock-refresh-token-abc'

describe('auth.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    })
    mockSessionStorage.clear()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have null user initially', () => {
      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
    })

    it('should have null tokens initially', () => {
      const state = useAuthStore.getState()
      expect(state.accessToken).toBeNull()
      expect(state.refreshToken).toBeNull()
    })

    it('should not be authenticated initially', () => {
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
    })

    it('should not be loading initially', () => {
      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useAuthStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('setAuth', () => {
    it('should set user, tokens and mark as authenticated', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.accessToken).toBe(mockAccessToken)
      expect(state.refreshToken).toBe(mockRefreshToken)
      expect(state.isAuthenticated).toBe(true)
    })

    it('should clear loading state', () => {
      useAuthStore.setState({ isLoading: true })

      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should clear any existing error', () => {
      useAuthStore.setState({ error: 'Previous error' })

      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const state = useAuthStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('setTokens', () => {
    it('should update only the tokens', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const newAccessToken = 'new-access-token'
      const newRefreshToken = 'new-refresh-token'
      useAuthStore.getState().setTokens(newAccessToken, newRefreshToken)

      const state = useAuthStore.getState()
      expect(state.accessToken).toBe(newAccessToken)
      expect(state.refreshToken).toBe(newRefreshToken)
      expect(state.user).toEqual(mockUser) // User should remain unchanged
      expect(state.isAuthenticated).toBe(true) // Auth state should remain unchanged
    })

    it('should not affect other state properties', () => {
      useAuthStore.setState({ isLoading: true, error: 'Some error' })

      useAuthStore.getState().setTokens('new-token', 'new-refresh')

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(true)
      expect(state.error).toBe('Some error')
    })
  })

  describe('setUser', () => {
    it('should update only the user', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const updatedUser: User = {
        ...mockUser,
        firstName: 'Jane',
        lastName: 'Smith',
      }
      useAuthStore.getState().setUser(updatedUser)

      const state = useAuthStore.getState()
      expect(state.user).toEqual(updatedUser)
      expect(state.user?.firstName).toBe('Jane')
      expect(state.accessToken).toBe(mockAccessToken) // Tokens should remain unchanged
    })

    it('should not affect authentication state', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      const updatedUser: User = { ...mockUser, email: 'new@example.com' }
      useAuthStore.getState().setUser(updatedUser)

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
    })
  })

  describe('setLoading', () => {
    it('should set loading to true', () => {
      useAuthStore.getState().setLoading(true)

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(true)
    })

    it('should set loading to false', () => {
      useAuthStore.setState({ isLoading: true })

      useAuthStore.getState().setLoading(false)

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should not affect other state properties', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      useAuthStore.getState().setLoading(true)

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isAuthenticated).toBe(true)
    })
  })

  describe('setError', () => {
    it('should set the error message', () => {
      const errorMessage = 'Authentication failed'
      useAuthStore.getState().setError(errorMessage)

      const state = useAuthStore.getState()
      expect(state.error).toBe(errorMessage)
    })

    it('should clear loading state when setting error', () => {
      useAuthStore.setState({ isLoading: true })

      useAuthStore.getState().setError('Some error')

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should allow setting error to null', () => {
      useAuthStore.setState({ error: 'Previous error' })

      useAuthStore.getState().setError(null)

      const state = useAuthStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('logout', () => {
    it('should reset all state to initial values', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
      expect(state.refreshToken).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should clear error state on logout', () => {
      useAuthStore.setState({ error: 'Some error' })

      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.error).toBeNull()
    })

    it('should clear loading state on logout', () => {
      useAuthStore.setState({ isLoading: true })

      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should reset the kiosk lock store so no profile token leaks into the next session', () => {
      // Simulate a PIN-unlocked kiosk session: lock store holds another user's
      // profile token / active user and is left in a locked state.
      useLockStore.setState({
        isLocked: true,
        profileToken: 'leaked-profile-token',
        activeUser: {
          id: 'owner-1',
          firstName: 'Owner',
          lastName: 'Admin',
          role: 'OWNER',
          hasPinSet: true,
        } as never,
      })
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)

      useAuthStore.getState().logout()

      const lock = useLockStore.getState()
      expect(lock.profileToken).toBeNull()
      expect(lock.activeUser).toBeNull()
      expect(lock.isLocked).toBe(false)
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useAuthStore.setState({ error: 'Some error' })

      useAuthStore.getState().clearError()

      const state = useAuthStore.getState()
      expect(state.error).toBeNull()
    })

    it('should not affect other state properties', () => {
      useAuthStore.getState().setAuth(mockUser, mockAccessToken, mockRefreshToken)
      useAuthStore.setState({ error: 'Some error' })

      useAuthStore.getState().clearError()

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isAuthenticated).toBe(true)
      expect(state.accessToken).toBe(mockAccessToken)
    })
  })

  describe('User type', () => {
    it.each<User['role']>(['OWNER', 'ADMIN', 'DOCTOR', 'STAFF'])(
      'should support %s role',
      (role) => {
        const userWithRole: User = { ...mockUser, role }
        useAuthStore.getState().setAuth(userWithRole, mockAccessToken, mockRefreshToken)

        const state = useAuthStore.getState()
        expect(state.user?.role).toBe(role)
      }
    )

    it('should support user without optional fields', () => {
      const minimalUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'STAFF',
        tenantId: 'tenant-456',
      }

      useAuthStore.getState().setAuth(minimalUser, mockAccessToken, mockRefreshToken)

      const state = useAuthStore.getState()
      expect(state.user).toEqual(minimalUser)
      expect(state.user?.avatar).toBeUndefined()
      expect(state.user?.phone).toBeUndefined()
      expect(state.user?.tenant).toBeUndefined()
    })
  })

  describe('state persistence', () => {
    it('should be configured with sessionStorage persistence', () => {
      // Verify the store has persist middleware configured
      // The persist middleware adds a persist property to the store
      const store = useAuthStore
      expect(store.persist).toBeDefined()
      expect(store.persist.getOptions().name).toBe('dental-auth')
    })

    it('should have partialize configured to exclude transient state', () => {
      // Verify partialize excludes isLoading and error
      const store = useAuthStore
      const partialize = store.persist.getOptions().partialize

      if (partialize) {
        const fullState = {
          user: mockUser,
          accessToken: mockAccessToken,
          refreshToken: mockRefreshToken,
          isAuthenticated: true,
          isLoading: true,
          error: 'test error',
          setAuth: vi.fn(),
          setTokens: vi.fn(),
          setUser: vi.fn(),
          setLoading: vi.fn(),
          setError: vi.fn(),
          logout: vi.fn(),
          clearError: vi.fn(),
        }

        const partializedState = partialize(fullState)

        // According to partialize config, only these should be persisted
        expect(partializedState).toHaveProperty('user')
        expect(partializedState).toHaveProperty('accessToken')
        expect(partializedState).toHaveProperty('refreshToken')
        expect(partializedState).toHaveProperty('isAuthenticated')
        // isLoading and error should NOT be persisted
        expect(partializedState).not.toHaveProperty('isLoading')
        expect(partializedState).not.toHaveProperty('error')
      }
    })
  })
})
