import { useMemo, useState } from 'react'
import { useNavigate, Navigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { adminApiClient } from '@/lib/admin-api'
import { useAdminStore } from '@/stores/admin.store'
import { Shield, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { AxiosError } from 'axios'

function createLoginSchema(t: TFunction) {
  return z.object({
    email: z.string().email(t('admin.validation.invalidEmail')),
    password: z.string().min(1, t('admin.validation.passwordRequired')),
  })
}

type LoginFormData = z.infer<ReturnType<typeof createLoginSchema>>

export function AdminLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAdminStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const loginSchema = useMemo(() => createLoginSchema(t), [t])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  // If already authenticated, redirect to dashboard
  if (isAuthenticated) {
    return <Navigate to="/admin/dashboard" replace />
  }

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Use the admin auth login endpoint
      const response = await adminApiClient.post('/auth/login', {
        email: data.email,
        password: data.password,
      })

      const { user, accessToken, refreshToken } = response.data

      // Store auth data
      setAuth(
        {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: 'SUPER_ADMIN',
          createdAt: user.createdAt,
        },
        accessToken,
        refreshToken
      )

      navigate('/admin/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof AxiosError) {
        const message = err.response?.data?.error?.message || t('admin.login.invalidCredentials')
        setError(message)
      } else {
        setError(t('admin.common.unexpectedError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Shield className="h-16 w-16 text-blue-500 mx-auto" />
          <h1 className="mt-4 text-3xl font-bold text-white">
            {t('admin.login.title')}
          </h1>
          <p className="mt-2 text-gray-400">
            {t('admin.login.subtitle')}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-800 rounded-xl p-8 shadow-xl">
          {error && (
            <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('admin.common.email')}
              </label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="admin@dental-saas.com"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('admin.common.password')}
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="w-full px-4 py-2 pr-10 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
              )}

              <div className="mt-2 text-right">
                <Link
                  to="/admin/forgot-password"
                  className="text-sm text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {t('admin.login.forgotPasswordLink')}
                </Link>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('admin.login.submitting')}
              </>
            ) : (
              t('admin.login.submit')
            )}
          </button>

          <p className="mt-4 text-center text-sm text-gray-500">
            {t('admin.login.firstTimePrompt')}{' '}
            <a href="/admin/setup" className="text-blue-400 hover:text-blue-300">
              {t('admin.login.setupLink')}
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}

export default AdminLoginPage
