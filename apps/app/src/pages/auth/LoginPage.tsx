import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth.store'
import { AxiosError } from 'axios'

function createLoginSchema(t: TFunction) {
  return z.object({
    email: z.string().email(t('auth.validation.invalidEmail')),
    password: z.string().min(1, t('auth.validation.passwordRequired')),
    clinicSlug: z.string().min(1, t('auth.validation.clinicSlugRequired')),
  })
}

type LoginFormData = z.infer<ReturnType<typeof createLoginSchema>>

export function LoginPage() {
  const { t } = useTranslation()
  const { clinicSlug: urlClinicSlug } = useParams<{ clinicSlug?: string }>()
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('session') === 'expired'
  const { login, isLoading, error, clearError } = useAuth()
  const { isAuthenticated } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)

  const loginSchema = useMemo(() => createLoginSchema(t), [t])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      clinicSlug: urlClinicSlug || '',
    },
  })

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const onSubmit = async (data: LoginFormData) => {
    clearError()
    try {
      await login(data)
    } catch (err) {
      // Error is handled by the hook
      if (err instanceof AxiosError) {
        console.error('Login error:', err.response?.data)
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-extrabold text-gray-900">
            🦷 Alveo System
          </h1>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            {t('auth.login')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t('auth.dontHaveAccount')}{' '}
            <Link
              to="/register"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              {t('auth.registerHere')}
            </Link>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          {sessionExpired && !error && (
            <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
              <p className="text-sm text-yellow-800">
                {t('auth.sessionExpired')}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">{error}</h3>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg shadow-md border border-gray-200 p-6 space-y-4">
            {!urlClinicSlug && (
              <div>
                <label
                  htmlFor="clinicSlug"
                  className="block text-sm font-medium text-gray-700"
                >
                  {t('auth.clinicSlug')}
                </label>
                <input
                  {...register('clinicSlug')}
                  id="clinicSlug"
                  type="text"
                  autoComplete="organization"
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder={t('auth.clinicSlugPlaceholder')}
                />
                {errors.clinicSlug && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.clinicSlug.message}
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                {t('auth.email')}
              </label>
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t('auth.emailPlaceholder')}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                {t('auth.password')}
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10"
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              {urlClinicSlug && (
                <Link
                  to="/login"
                  className="font-medium text-blue-600 hover:text-blue-500"
                >
                  {t('auth.changeClinic')}
                </Link>
              )}
            </div>
            <div className="text-sm">
              <Link
                to="/forgot-password"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                {t('auth.forgotPassword')}
              </Link>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t('common.loading')}
                </span>
              ) : (
                t('auth.login')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
