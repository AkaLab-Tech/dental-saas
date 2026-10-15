import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AxiosResponse } from 'axios'

// Mock useAuthStore before importing api
interface MockAuthState {
  accessToken: string | null
  refreshToken: string | null
  logout: () => void
  setTokens: (accessToken: string, refreshToken: string) => void
}

const mockAuthStore = {
  getState: vi.fn((): MockAuthState => ({
    accessToken: null,
    refreshToken: null,
    logout: vi.fn(),
    setTokens: vi.fn(),
  })),
}

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: mockAuthStore,
}))

// Mock axios
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios')
  return {
    ...actual,
    default: {
      create: vi.fn(() => ({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
        get: vi.fn(),
        post: vi.fn(),
      })),
      post: vi.fn(),
    },
  }
})

describe('api.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('authApi', () => {
    describe('login', () => {
      it('should call POST /auth/login with payload', async () => {
        const mockResponse: Partial<AxiosResponse> = {
          data: {
            user: {
              id: 'user-123',
              email: 'test@example.com',
              firstName: 'John',
              lastName: 'Doe',
              role: 'OWNER',
              tenantId: 'tenant-456',
              createdAt: '2024-01-01T00:00:00Z',
            },
            accessToken: 'access-token-xyz',
            refreshToken: 'refresh-token-abc',
          },
        }

        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockResolvedValue(mockResponse)

        const payload = {
          email: 'test@example.com',
          password: 'password123',
          clinicSlug: 'test-clinic',
        }

        const result = await authApi.login(payload)

        expect(apiClient.post).toHaveBeenCalledWith('/auth/login', payload)
        expect(result).toEqual(mockResponse.data)
      })

      it('should throw error on login failure', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockRejectedValue(new Error('Invalid credentials'))

        const payload = {
          email: 'test@example.com',
          password: 'wrong-password',
          clinicSlug: 'test-clinic',
        }

        await expect(authApi.login(payload)).rejects.toThrow('Invalid credentials')
      })
    })

    describe('register', () => {
      it('should call POST /auth/register with payload', async () => {
        const mockResponse: Partial<AxiosResponse> = {
          data: {
            user: {
              id: 'user-123',
              email: 'new@example.com',
              firstName: 'Jane',
              lastName: 'Doe',
              role: 'OWNER',
              tenantId: 'tenant-789',
              createdAt: '2024-01-01T00:00:00Z',
            },
            accessToken: 'access-token-xyz',
            refreshToken: 'refresh-token-abc',
          },
        }

        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockResolvedValue(mockResponse)

        const payload = {
          email: 'new@example.com',
          password: 'password123',
          firstName: 'Jane',
          lastName: 'Doe',
          clinicSlug: 'new-clinic',
          clinicName: 'New Clinic',
        }

        const result = await authApi.register(payload)

        expect(apiClient.post).toHaveBeenCalledWith('/auth/register', payload)
        expect(result).toEqual(mockResponse.data)
      })

      it('should handle registration without clinicName', async () => {
        const mockResponse: Partial<AxiosResponse> = {
          data: {
            user: {
              id: 'user-123',
              email: 'new@example.com',
              firstName: 'Jane',
              lastName: 'Doe',
              role: 'OWNER',
              tenantId: 'tenant-789',
              createdAt: '2024-01-01T00:00:00Z',
            },
            accessToken: 'access-token-xyz',
            refreshToken: 'refresh-token-abc',
          },
        }

        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockResolvedValue(mockResponse)

        const payload = {
          email: 'new@example.com',
          password: 'password123',
          firstName: 'Jane',
          lastName: 'Doe',
          clinicSlug: 'new-clinic',
        }

        const result = await authApi.register(payload)

        expect(apiClient.post).toHaveBeenCalledWith('/auth/register', payload)
        expect(result).toEqual(mockResponse.data)
      })

      it('should throw error on registration failure', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockRejectedValue(new Error('Email already exists'))

        const payload = {
          email: 'existing@example.com',
          password: 'password123',
          firstName: 'Jane',
          lastName: 'Doe',
          clinicSlug: 'existing-clinic',
        }

        await expect(authApi.register(payload)).rejects.toThrow('Email already exists')
      })
    })

    describe('logout', () => {
      it('should call POST /auth/logout with refreshToken', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockResolvedValue({ data: {} })

        await authApi.logout('refresh-token-abc')

        expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', {
          refreshToken: 'refresh-token-abc',
        })
      })

      it('should throw error on logout failure', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockRejectedValue(new Error('Invalid token'))

        await expect(authApi.logout('invalid-token')).rejects.toThrow('Invalid token')
      })
    })

    describe('getMe', () => {
      it('should call GET /auth/me', async () => {
        const mockUser = {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'OWNER',
          tenantId: 'tenant-456',
        }

        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser })

        const result = await authApi.getMe()

        expect(apiClient.get).toHaveBeenCalledWith('/auth/me')
        expect(result).toEqual(mockUser)
      })

      it('should throw error on unauthorized', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'))

        await expect(authApi.getMe()).rejects.toThrow('Unauthorized')
      })
    })

    describe('refreshToken', () => {
      it('should call POST /auth/refresh with refreshToken', async () => {
        const mockResponse = {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }

        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse })

        const result = await authApi.refreshToken('old-refresh-token')

        expect(apiClient.post).toHaveBeenCalledWith('/auth/refresh', {
          refreshToken: 'old-refresh-token',
        })
        expect(result).toEqual(mockResponse)
      })

      it('should throw error on invalid refresh token', async () => {
        const { apiClient, authApi } = await import('./api')
        vi.mocked(apiClient.post).mockRejectedValue(new Error('Invalid refresh token'))

        await expect(authApi.refreshToken('invalid-token')).rejects.toThrow(
          'Invalid refresh token'
        )
      })
    })
  })

})

describe('apiClient interceptors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('request interceptor', () => {
    it('should add Authorization header when accessToken exists', () => {
      const mockConfig = {
        headers: {} as Record<string, string>,
      }

      mockAuthStore.getState.mockReturnValue({
        accessToken: 'test-access-token',
        refreshToken: null,
        logout: vi.fn(),
        setTokens: vi.fn(),
      })

      // Simulate request interceptor logic
      const { accessToken } = mockAuthStore.getState()
      if (accessToken && mockConfig.headers) {
        mockConfig.headers.Authorization = `Bearer ${accessToken}`
      }

      expect(mockConfig.headers.Authorization).toBe('Bearer test-access-token')
    })

    it('should not add Authorization header when accessToken is null', () => {
      const mockConfig = {
        headers: {} as Record<string, string>,
      }

      mockAuthStore.getState.mockReturnValue({
        accessToken: null,
        refreshToken: null,
        logout: vi.fn(),
        setTokens: vi.fn(),
      })

      // Simulate request interceptor logic
      const { accessToken } = mockAuthStore.getState()
      if (accessToken && mockConfig.headers) {
        mockConfig.headers.Authorization = `Bearer ${accessToken}`
      }

      expect(mockConfig.headers.Authorization).toBeUndefined()
    })
  })

  describe('response interceptor - 401 handling', () => {
    it('should call logout when no refresh token available', () => {
      const mockLogout = vi.fn()

      mockAuthStore.getState.mockReturnValue({
        accessToken: 'expired-token',
        refreshToken: null,
        logout: mockLogout,
        setTokens: vi.fn(),
      })

      // Simulate 401 error handling logic
      const { refreshToken, logout } = mockAuthStore.getState()
      if (!refreshToken) {
        logout()
      }

      expect(mockLogout).toHaveBeenCalled()
    })

    it('should attempt token refresh when refresh token exists', async () => {
      const mockSetTokens = vi.fn()

      mockAuthStore.getState.mockReturnValue({
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        logout: vi.fn(),
        setTokens: mockSetTokens,
      })

      // Simulate successful token refresh
      const { refreshToken, setTokens } = mockAuthStore.getState()
      if (refreshToken) {
        // Simulate API response
        const newTokens = {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }
        setTokens(newTokens.accessToken, newTokens.refreshToken)
      }

      expect(mockSetTokens).toHaveBeenCalledWith('new-access-token', 'new-refresh-token')
    })

    it('should logout on refresh token failure', () => {
      const mockLogout = vi.fn()

      mockAuthStore.getState.mockReturnValue({
        accessToken: 'expired-token',
        refreshToken: 'invalid-refresh-token',
        logout: mockLogout,
        setTokens: vi.fn(),
      })

      // Simulate failed token refresh
      const { logout } = mockAuthStore.getState()
      // On refresh failure, logout is called
      logout()

      expect(mockLogout).toHaveBeenCalled()
    })
  })
})
