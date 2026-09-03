import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import type { UserRole } from '@dental/shared'
import { useAuthStore } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'

export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false,
})

// Request interceptor - add access token and profile token to requests
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    const { profileToken } = useLockStore.getState()
    if (profileToken && config.headers) {
      config.headers['X-Profile-Token'] = profileToken
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - handle token refresh
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else if (token) {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: { code?: string } }>) => {
    // Handle profile token expiration — auto-lock
    if (error.response?.status === 403 && error.response?.data?.error?.code === 'PROFILE_TOKEN_EXPIRED') {
      useLockStore.getState().lock()
      return Promise.reject(error)
    }

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    // Skip token refresh logic for auth endpoints — their 401s are
    // credential errors (wrong password, etc.), not expired sessions.
    const isAuthRequest = originalRequest.url?.startsWith('/auth/')

    // If error is 401 and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthRequest) {
      const { refreshToken, logout, setTokens } = useAuthStore.getState()

      // If no refresh token, logout
      if (!refreshToken) {
        logout()
        window.location.href = '/login?session=expired'
        return Promise.reject(error)
      }

      // If already refreshing, queue the request
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`
            }
            return apiClient(originalRequest)
          })
          .catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // NOTE: Using axios directly instead of apiClient to avoid infinite loops
        // if the refresh endpoint also returns 401. This bypasses our interceptors.
        const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
          refreshToken,
        })

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
          response.data

        setTokens(newAccessToken, newRefreshToken)
        processQueue(null, newAccessToken)

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        }
        return apiClient(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError as Error, null)
        logout()
        window.location.href = '/login?session=expired'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

// Auth API functions
export interface LoginPayload {
  email: string
  password: string
  clinicSlug: string
}

export interface RegisterPayload {
  email: string
  password: string
  firstName: string
  lastName: string
  clinicSlug: string
  clinicName?: string
  language?: string
}

export interface AuthResponse {
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: Exclude<UserRole, 'SUPER_ADMIN'>
    tenantId: string
    createdAt: string
    tenant?: {
      id: string
      name: string
      slug: string
      logo?: string
      currency: string
    }
  }
  accessToken: string
  refreshToken: string
}

export interface ProfileUser {
  id: string
  firstName: string
  lastName: string
  role: string
  avatar: string | null
  hasPinSet: boolean
}

export interface PinLoginPayload {
  userId: string
  pin: string
}

export interface ProfileLoginResponse {
  profileToken: string
  user: ProfileUser
}

export interface SetupPinResponse {
  // Absent when an ADMIN provisions someone else's PIN — provisioning must
  // not hand back a token for the target user's role.
  profileToken?: string
  user: ProfileUser
}

export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', payload)
    return response.data
  },

  register: async (payload: RegisterPayload): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>(
      '/auth/register',
      payload
    )
    return response.data
  },

  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post('/auth/logout', { refreshToken })
  },

  getMe: async () => {
    const response = await apiClient.get('/auth/me')
    return response.data
  },

  refreshToken: async (refreshToken: string) => {
    const response = await apiClient.post('/auth/refresh', { refreshToken })
    return response.data
  },

  getProfiles: async (): Promise<ProfileUser[]> => {
    const response = await apiClient.get<ProfileUser[]>('/auth/profiles')
    return response.data
  },

  pinLogin: async (payload: PinLoginPayload): Promise<ProfileLoginResponse> => {
    const response = await apiClient.post<ProfileLoginResponse>('/auth/pin-login', payload)
    return response.data
  },

  setupPin: async (payload: PinLoginPayload): Promise<SetupPinResponse> => {
    const response = await apiClient.post<SetupPinResponse>('/auth/setup-pin', payload)
    return response.data
  },
}

export default apiClient
