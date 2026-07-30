import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { apiClient } from '@/lib/api'
import { AxiosError } from 'axios'

function createResetPasswordSchema(t: TFunction) {
  return z.object({
    password: z
      .string()
      .min(8, t('auth.validation.passwordMinLength'))
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
        message: t('auth.validation.passwordComplexityBasic'),
      }),
    confirmPassword: z.string().min(1, t('auth.validation.confirmPasswordRequired')),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('auth.validation.passwordMismatch'),
    path: ['confirmPassword'],
  })
}

type ResetPasswordFormData = z.infer<ReturnType<typeof createResetPasswordSchema>>

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const resetPasswordSchema = useMemo(() => createResetPasswordSchema(t), [t])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  })

  // Validate token presence
  useEffect(() => {
    if (!token) {
      setError(t('auth.invalidResetLink'))
    }
  }, [token, t])

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) return

    setIsSubmitting(true)
    setError(null)

    try {
      await apiClient.post('/auth/reset-password', {
        token,
        password: data.password,
      })

      setIsSuccess(true)
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login')
      }, 3000)
    } catch (err) {
      if (err instanceof AxiosError) {
        const code = err.response?.data?.error?.code
        let message = err.response?.data?.error?.message || t('auth.errorResettingPassword')

        // Translate common error codes
        if (code === 'TOKEN_EXPIRED') {
          message = t('auth.tokenExpired')
        } else if (code === 'TOKEN_USED') {
          message = t('auth.tokenUsed')
        } else if (code === 'INVALID_TOKEN') {
          message = t('auth.invalidToken')
        } else if (code === 'ACCOUNT_INACTIVE') {
          message = t('auth.accountInactive')
        }

        setError(message)
      } else {
        setError(t('auth.unexpectedError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-gray-900">🦷 Alveo System</h1>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">
            {t('auth.newPassword')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('auth.enterNewPasswordSubtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8">
          {isSuccess ? (
            /* Success State */
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {t('auth.passwordUpdated')}
              </h3>
              <p className="text-gray-600 mb-6">
                {t('auth.passwordResetSuccessMessage')}
              </p>
              <Link
                to="/login"
                className="text-blue-600 hover:text-blue-500 font-medium"
              >
                {t('auth.goToLogin')}
              </Link>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
              {error && (
                <div className="rounded-md bg-red-50 p-4">
                  <div className="flex">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <div className="ml-3">
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {!token ? (
                <div className="text-center py-4">
                  <Link
                    to="/forgot-password"
                    className="text-blue-600 hover:text-blue-500 font-medium"
                  >
                    {t('auth.requestNewResetLink')}
                  </Link>
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-gray-700"
                    >
                      {t('auth.newPassword')}
                    </label>
                    <div className="relative mt-1">
                      <input
                        {...register('password')}
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10"
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
                      <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      {t('auth.passwordHelp')}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="confirmPassword"
                      className="block text-sm font-medium text-gray-700"
                    >
                      {t('auth.confirmPassword')}
                    </label>
                    <div className="relative mt-1">
                      <input
                        {...register('confirmPassword')}
                        id="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10"
                        placeholder={t('auth.passwordPlaceholder')}
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 pr-3 flex items-center"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      >
                        {showConfirmPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {t('auth.updating')}
                      </span>
                    ) : (
                      t('auth.resetPassword')
                    )}
                  </button>
                </>
              )}

              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-blue-600 hover:text-blue-500"
                >
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordPage
