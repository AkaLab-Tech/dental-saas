import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { adminSetupApi } from '@/lib/admin-api'
import { useAdminStore } from '@/stores/admin.store'
import { Shield, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { AxiosError } from 'axios'

function createSetupSchema(t: TFunction) {
  return z
    .object({
      email: z.string().email(t('admin.validation.invalidEmail')),
      password: z
        .string()
        .min(12, t('admin.validation.passwordMinLength12'))
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
          message: t('admin.validation.passwordComplexity'),
        }),
      confirmPassword: z.string(),
      firstName: z.string().min(1, t('admin.validation.firstNameRequired')),
      lastName: z.string().min(1, t('admin.validation.lastNameRequired')),
      setupKey: z.string().min(1, t('admin.validation.setupKeyRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('admin.validation.passwordMismatch'),
      path: ['confirmPassword'],
    })
}

type SetupFormData = z.infer<ReturnType<typeof createSetupSchema>>

export function AdminSetupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAdminStore()
  const [setupAvailable, setSetupAvailable] = useState<boolean | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const setupSchema = useMemo(() => createSetupSchema(t), [t])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
  })

  useEffect(() => {
    // If already authenticated as admin, redirect to dashboard
    if (isAuthenticated) {
      navigate('/admin/dashboard', { replace: true })
      return
    }

    // Check if setup is available
    const checkSetupStatus = async () => {
      try {
        const status = await adminSetupApi.checkStatus()
        setSetupAvailable(status.setupAvailable)
      } catch {
        setError(t('admin.setup.errorCheckingStatus'))
      } finally {
        setIsCheckingStatus(false)
      }
    }

    checkSetupStatus()
  }, [isAuthenticated, navigate, t])

  const onSubmit = async (data: SetupFormData) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await adminSetupApi.createSuperAdmin({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        setupKey: data.setupKey,
      })

      // Store auth data
      setAuth(response.user, response.accessToken, response.refreshToken)
      setSuccess(true)

      // Redirect after success
      setTimeout(() => {
        navigate('/admin/dashboard', { replace: true })
      }, 2000)
    } catch (err) {
      if (err instanceof AxiosError) {
        const message = err.response?.data?.error?.message || t('admin.setup.errorCreatingSuperAdmin')
        setError(message)
      } else {
        setError(t('admin.common.unexpectedError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (isCheckingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
          <p className="mt-4 text-gray-400">{t('admin.setup.checkingStatus')}</p>
        </div>
      </div>
    )
  }

  // Setup not available (super admin already exists)
  if (setupAvailable === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-md w-full px-6 text-center">
          <Shield className="h-16 w-16 text-gray-600 mx-auto" />
          <h1 className="mt-6 text-2xl font-bold text-white">
            {t('admin.setup.unavailableTitle')}
          </h1>
          <p className="mt-2 text-gray-400">
            {t('admin.setup.unavailableMessage')}
          </p>
          <a
            href="/admin/login"
            className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('admin.setup.goToLogin')}
          </a>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-md w-full px-6 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
          <h1 className="mt-6 text-2xl font-bold text-white">
            {t('admin.setup.successTitle')}
          </h1>
          <p className="mt-2 text-gray-400">
            {t('admin.setup.successMessage')}
          </p>
        </div>
      </div>
    )
  }

  // Setup form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Shield className="h-16 w-16 text-blue-500 mx-auto" />
          <h1 className="mt-4 text-3xl font-bold text-white">
            {t('admin.setup.title')}
          </h1>
          <p className="mt-2 text-gray-400">
            {t('admin.setup.subtitle')}
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
            {/* Setup Key */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('admin.setup.setupKeyLabel')}
              </label>
              <input
                {...register('setupKey')}
                type="password"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('admin.setup.setupKeyPlaceholder')}
              />
              {errors.setupKey && (
                <p className="mt-1 text-sm text-red-400">{errors.setupKey.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* First Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('admin.setup.firstNameLabel')}
                </label>
                <input
                  {...register('firstName')}
                  type="text"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('admin.setup.firstNamePlaceholder')}
                />
                {errors.firstName && (
                  <p className="mt-1 text-sm text-red-400">{errors.firstName.message}</p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('admin.setup.lastNameLabel')}
                </label>
                <input
                  {...register('lastName')}
                  type="text"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('admin.setup.lastNamePlaceholder')}
                />
                {errors.lastName && (
                  <p className="mt-1 text-sm text-red-400">{errors.lastName.message}</p>
                )}
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('admin.common.email')}
              </label>
              <input
                {...register('email')}
                type="email"
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
              <input
                {...register('password')}
                type="password"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('admin.setup.passwordPlaceholder')}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('admin.setup.confirmPasswordLabel')}
              </label>
              <input
                {...register('confirmPassword')}
                type="password"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('admin.setup.confirmPasswordPlaceholder')}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-400">{errors.confirmPassword.message}</p>
              )}
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
                {t('admin.setup.submitting')}
              </>
            ) : (
              t('admin.setup.submit')
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default AdminSetupPage
