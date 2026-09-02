import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link, Navigate } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth.store'
import { PASSWORD_REGEX } from '@/lib/constants'
import { generateSlug, sanitizeSlugInput } from '@/lib/slug'
import { LanguageSelector } from '@/components/ui/LanguageSelector'

function createRegisterSchema(t: TFunction) {
  return z
    .object({
      clinicName: z
        .string()
        .min(2, t('auth.validation.clinicNameMinLength'))
        .optional(),
      clinicSlug: z
        .string()
        .min(3, t('auth.validation.clinicSlugMinLength'))
        .max(50, t('auth.validation.clinicSlugMaxLength'))
        .regex(/^[a-z0-9-]+$/, t('auth.validation.clinicSlugPattern')),
      email: z.string().email(t('auth.validation.invalidEmail')),
      password: z
        .string()
        .min(8, t('auth.validation.passwordMinLength'))
        .regex(PASSWORD_REGEX, t('auth.validation.passwordComplexity')),
      confirmPassword: z.string(),
      firstName: z.string().min(1, t('auth.validation.firstNameRequired')),
      lastName: z.string().min(1, t('auth.validation.lastNameRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('auth.validation.passwordMismatch'),
      path: ['confirmPassword'],
    })
}

type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>

export function RegisterPage() {
  const { t, i18n } = useTranslation()
  const { register: registerUser, isLoading, error, clearError } = useAuth()
  const { isAuthenticated } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isSlugDirty, setIsSlugDirty] = useState(false)

  const registerSchema = useMemo(() => createRegisterSchema(t), [t])

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      clinicName: '',
      clinicSlug: '',
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
    },
  })

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const onSubmit = async (data: RegisterFormData) => {
    clearError()
    try {
      const { confirmPassword: _, ...registerData } = data
      await registerUser({ ...registerData, language: i18n.resolvedLanguage })
    } catch (err) {
      // Error is handled by the useAuth hook
      console.error('Register error:', err)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="flex justify-end">
          <LanguageSelector variant="buttons" />
        </div>
        <div>
          <h1 className="text-center text-3xl font-extrabold text-gray-900">
            🦷 Alveo System
          </h1>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            {t('auth.createAccount')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link
              to="/login"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              {t('auth.loginHere')}
            </Link>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
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
            <div>
              <label
                htmlFor="clinicName"
                className="block text-sm font-medium text-gray-700"
              >
                {t('auth.clinicName')}
              </label>
              <input
                {...register('clinicName', {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    if (!isSlugDirty) {
                      setValue('clinicSlug', generateSlug(e.target.value))
                    }
                  },
                })}
                id="clinicName"
                type="text"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t('auth.clinicNamePlaceholder')}
              />
              {errors.clinicName && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.clinicName.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="clinicSlug"
                className="block text-sm font-medium text-gray-700"
              >
                {t('auth.clinicSlugUrlLabel')}
              </label>
              <input
                {...register('clinicSlug', {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    const sanitized = sanitizeSlugInput(e.target.value)
                    if (sanitized === '') {
                      setIsSlugDirty(false)
                      const generated = generateSlug(getValues('clinicName') ?? '')
                      e.target.value = generated
                      setValue('clinicSlug', generated)
                    } else {
                      setIsSlugDirty(true)
                      e.target.value = sanitized
                      setValue('clinicSlug', sanitized)
                    }
                  },
                })}
                id="clinicSlug"
                type="text"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t('auth.clinicSlugUrlPlaceholder')}
              />
              {errors.clinicSlug && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.clinicSlug.message}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {t('auth.clinicSlugHelp')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-sm font-medium text-gray-700"
                >
                  {t('auth.firstName')}
                </label>
                <input
                  {...register('firstName')}
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder={t('auth.firstNamePlaceholder')}
                />
                {errors.firstName && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.firstName.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="lastName"
                  className="block text-sm font-medium text-gray-700"
                >
                  {t('auth.lastName')}
                </label>
                <input
                  {...register('lastName')}
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder={t('auth.lastNamePlaceholder')}
                />
                {errors.lastName && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

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
                  autoComplete="new-password"
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
              <div className="relative">
                <input
                  {...register('confirmPassword')}
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10"
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={
                    showConfirmPassword
                      ? t('auth.hideConfirmPassword')
                      : t('auth.showConfirmPassword')
                  }
                >
                  {showConfirmPassword ? '🙈' : '👁️'}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.confirmPassword.message}
                </p>
              )}
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
                  {t('auth.creatingAccount')}
                </span>
              ) : (
                t('auth.createAccount')
              )}
            </button>
          </div>

          <p className="text-center text-xs text-gray-500">
            {t('auth.termsPrefix')}{' '}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-blue-600 hover:text-blue-500"
            >
              {t('auth.termsOfService')}
            </a>{' '}
            {t('auth.termsAnd')}{' '}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-blue-600 hover:text-blue-500"
            >
              {t('auth.privacyPolicy')}
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}

export default RegisterPage
