import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { UserRole } from '@dental/shared'

// Define mock functions at module level (hoisted)
const mockNavigate = vi.fn()
const mockSetAuth = vi.fn()
const mockSetLoading = vi.fn()
const mockSetError = vi.fn()
const mockStoreLogout = vi.fn()
const mockClearError = vi.fn()
const mockLogin = vi.fn()
const mockRegister = vi.fn()
const mockApiLogout = vi.fn()

// Mutable state for store mock
const mockStoreState = {
  user: null as { id: string; email: string; firstName: string; lastName: string; role: 'OWNER' | 'ADMIN' | 'DOCTOR' | 'STAFF'; tenantId: string } | null,
  accessToken: null as string | null,
  refreshToken: null as string | null,
  isAuthenticated: false,
  isLoading: false,
  error: null as string | null,
}

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    ...mockStoreState,
    setAuth: mockSetAuth,
    setLoading: mockSetLoading,
    setError: mockSetError,
    logout: mockStoreLogout,
    clearError: mockClearError,
  }),
}))

vi.mock('@/lib/api', () => ({
  authApi: {
    login: (...args: unknown[]) => mockLogin(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    logout: (...args: unknown[]) => mockApiLogout(...args),
  },
}))

vi.mock('@/lib/constants', () => ({
  ROLE_HIERARCHY: {
    OWNER: 4,
    ADMIN: 3,
    DOCTOR: 2,
    STAFF: 1,
  },
}))

// Import after mocks
import { useAuth } from './useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.user = null
    mockStoreState.accessToken = null
    mockStoreState.refreshToken = null
    mockStoreState.isAuthenticated = false
    mockStoreState.isLoading = false
    mockStoreState.error = null
  })

  describe('initial state', () => {
    it('should return auth state from store', () => {
      const { result } = renderHook(() => useAuth())

      expect(result.current.user).toBeNull()
      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should return authenticated user when logged in', () => {
      mockStoreState.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'ADMIN',
        tenantId: 'tenant-123',
      }
      mockStoreState.isAuthenticated = true
      mockStoreState.accessToken = 'access-token'

      const { result } = renderHook(() => useAuth())

      expect(result.current.user).toEqual(mockStoreState.user)
      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  describe('login', () => {
    it('should login successfully and navigate to home', async () => {
      const loginResponse = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'ADMIN' as const,
          tenantId: 'tenant-123',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }
      mockLogin.mockResolvedValue(loginResponse)

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.login({ email: 'test@example.com', password: 'password', clinicSlug: 'test-clinic' })
      })

      expect(mockSetLoading).toHaveBeenCalledWith(true)
      expect(mockClearError).toHaveBeenCalled()
      expect(mockLogin).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password', clinicSlug: 'test-clinic' })
      expect(mockSetAuth).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-123', email: 'test@example.com' }),
        'access-token',
        'refresh-token'
      )
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })

    it('should set error on login failure', async () => {
      const error = {
        response: { data: { message: 'Invalid credentials' } },
      }
      mockLogin.mockRejectedValue(error)

      const { result } = renderHook(() => useAuth())

      await expect(
        act(async () => {
          await result.current.login({ email: 'test@example.com', password: 'wrong', clinicSlug: 'test-clinic' })
        })
      ).rejects.toEqual(error)

      expect(mockSetError).toHaveBeenCalledWith('Invalid credentials')
    })

    it('should handle Error instance on login failure', async () => {
      const error = new Error('Network error')
      mockLogin.mockRejectedValue(error)

      const { result } = renderHook(() => useAuth())

      await expect(
        act(async () => {
          await result.current.login({ email: 'test@example.com', password: 'password', clinicSlug: 'test-clinic' })
        })
      ).rejects.toThrow('Network error')

      expect(mockSetError).toHaveBeenCalledWith('Network error')
    })
  })

  describe('register', () => {
    it('should register successfully and navigate to success page', async () => {
      const registerResponse = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'OWNER' as const,
          tenantId: 'tenant-123',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }
      mockRegister.mockResolvedValue(registerResponse)

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.register({
          email: 'test@example.com',
          password: 'Password1!',
          firstName: 'John',
          lastName: 'Doe',
          clinicName: 'My Clinic',
          clinicSlug: 'my-clinic',
        })
      })

      expect(mockSetLoading).toHaveBeenCalledWith(true)
      expect(mockRegister).toHaveBeenCalled()
      expect(mockSetAuth).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/register/success')
      )
    })

    it('should set error on register failure', async () => {
      const error = {
        response: { data: { message: 'Email already exists' } },
      }
      mockRegister.mockRejectedValue(error)

      const { result } = renderHook(() => useAuth())

      await expect(
        act(async () => {
          await result.current.register({
            email: 'test@example.com',
            password: 'Password1!',
            firstName: 'John',
            lastName: 'Doe',
            clinicName: 'My Clinic',
            clinicSlug: 'my-clinic',
          })
        })
      ).rejects.toEqual(error)

      expect(mockSetError).toHaveBeenCalledWith('Email already exists')
    })
  })

  describe('logout', () => {
    it('should logout and navigate to login page', async () => {
      mockStoreState.refreshToken = 'refresh-token'
      mockApiLogout.mockResolvedValue({})

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(mockApiLogout).toHaveBeenCalledWith('refresh-token')
      expect(mockStoreLogout).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })

    it('should still logout locally even if API call fails', async () => {
      mockStoreState.refreshToken = 'refresh-token'
      mockApiLogout.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(mockStoreLogout).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })

    it('should skip API call if no refresh token', async () => {
      mockStoreState.refreshToken = null

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(mockApiLogout).not.toHaveBeenCalled()
      expect(mockStoreLogout).toHaveBeenCalled()
    })
  })

  describe('hasRole', () => {
    it('should return false when user is not logged in', () => {
      const { result } = renderHook(() => useAuth())

      expect(result.current.hasRole(UserRole.ADMIN)).toBe(false)
    })

    it('should return true when user has the specified role', () => {
      mockStoreState.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'ADMIN',
        tenantId: 'tenant-123',
      }

      const { result } = renderHook(() => useAuth())

      expect(result.current.hasRole(UserRole.ADMIN)).toBe(true)
      expect(result.current.hasRole(UserRole.OWNER)).toBe(false)
    })

    it('should check multiple roles', () => {
      mockStoreState.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'DOCTOR',
        tenantId: 'tenant-123',
      }

      const { result } = renderHook(() => useAuth())

      expect(result.current.hasRole([UserRole.ADMIN, UserRole.DOCTOR])).toBe(true)
      expect(result.current.hasRole([UserRole.OWNER, UserRole.ADMIN])).toBe(false)
    })
  })

  describe('hasMinRole', () => {
    it('should return false when user is not logged in', () => {
      const { result } = renderHook(() => useAuth())

      expect(result.current.hasMinRole(UserRole.STAFF)).toBe(false)
    })

    it('should return true when user has minimum required role', () => {
      mockStoreState.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'ADMIN',
        tenantId: 'tenant-123',
      }

      const { result } = renderHook(() => useAuth())

      expect(result.current.hasMinRole(UserRole.STAFF)).toBe(true)
      expect(result.current.hasMinRole(UserRole.DOCTOR)).toBe(true)
      expect(result.current.hasMinRole(UserRole.ADMIN)).toBe(true)
      expect(result.current.hasMinRole(UserRole.OWNER)).toBe(false)
    })

    it('should return true for OWNER with any min role', () => {
      mockStoreState.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'OWNER',
        tenantId: 'tenant-123',
      }

      const { result } = renderHook(() => useAuth())

      expect(result.current.hasMinRole(UserRole.STAFF)).toBe(true)
      expect(result.current.hasMinRole(UserRole.DOCTOR)).toBe(true)
      expect(result.current.hasMinRole(UserRole.ADMIN)).toBe(true)
      expect(result.current.hasMinRole(UserRole.OWNER)).toBe(true)
    })
  })

  describe('clearError', () => {
    it('should call store clearError', () => {
      const { result } = renderHook(() => useAuth())

      result.current.clearError()

      expect(mockClearError).toHaveBeenCalled()
    })
  })
})
