import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { adminApiClient } from '@/lib/admin-api'
import { Shield, Loader2, AlertCircle, CheckCircle, ArrowLeft, Mail } from 'lucide-react'
import { AxiosError } from 'axios'

function createForgotPasswordSchema(t: TFunction) {
  return z.object({
    email: z.string().email(t('admin.validation.invalidEmail')),
  })
}

type ForgotPasswordFormData = z.infer<ReturnType<typeof createForgotPasswordSchema>>

export function AdminForgotPasswordPage() {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const forgotPasswordSchema = useMemo(() => createForgotPasswordSchema(t), [t])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsSubmitting(true)
    setError(null)

    try {
      await adminApiClient.post('/auth/forgot-password', {
        email: data.email,
      })

      setIsSuccess(true)
    } catch (err) {
      if (err instanceof AxiosError) {
        const message = err.response?.data?.error?.message || t('admin.forgotPassword.errorProcessingRequest')
        setError(message)
      } else {
        setError(t('admin.common.unexpectedError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('admin.forgotPassword.title')}</h1>
          <p className="text-gray-400 mt-2">{t('admin.common.superAdminPanelSubtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
          {isSuccess ? (
            /* Success State */
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600/20 rounded-full mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                {t('admin.forgotPassword.checkYourEmail')}
              </h2>
              <p className="text-gray-400 mb-6">
                {t('admin.forgotPassword.successMessage')}
              </p>
              <div className="flex items-center justify-center gap-2 text-purple-400 text-sm mb-6">
                <Mail className="w-4 h-4" />
                <span>{t('admin.forgotPassword.checkSpamFolder')}</span>
              </div>
              <Link
                to="/admin/login"
                className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('admin.common.backToLogin')}
              </Link>
            </div>
          ) : (
            /* Form */
            <>
              <p className="text-gray-400 text-sm mb-6">
                {t('admin.forgotPassword.formIntro')}
              </p>

              {error && (
                <div className="mb-4 p-4 bg-red-900/50 border border-red-700 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="text-red-200 text-sm">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    {t('admin.common.email')}
                  </label>
                  <input
                    {...register('email')}
                    type="email"
                    id="email"
                    autoComplete="email"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="admin@ejemplo.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('admin.forgotPassword.sending')}
                    </>
                  ) : (
                    t('admin.forgotPassword.submit')
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/admin/login"
                  className="inline-flex items-center gap-2 text-gray-400 hover:text-gray-300 transition-colors text-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('admin.common.backToLogin')}
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-sm mt-6">
          {t('admin.common.footerCopyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  )
}
