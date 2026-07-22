import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function RegisterSuccessPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const clinicName = searchParams.get('clinic') || t('auth.yourClinic')
  const clinicSlug = searchParams.get('slug') || ''

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="mb-8">
          <div className="mx-auto w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-5xl" role="img" aria-label={t('auth.registrationSuccessAriaLabel')}>✓</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-extrabold text-gray-900 mb-4">
          {t('auth.registrationSuccessTitle')}
        </h1>

        {/* Message */}
        <p className="text-lg text-gray-600 mb-2">
          {t('auth.clinicCreatedPrefix')}{' '}
          <strong className="text-blue-600">{clinicName}</strong>{' '}
          {t('auth.clinicCreatedSuffix')}
        </p>
        <p className="text-gray-500 mb-8">
          {t('auth.welcomeEmailSentMessage')}
        </p>

        {/* Clinic URL */}
        {clinicSlug && (
          <div className="bg-gray-100 rounded-xl p-4 mb-8">
            <p className="text-sm text-gray-500 mb-1">{t('auth.yourAccessUrl')}</p>
            <p className="text-lg font-mono font-semibold text-gray-900">
              app.alveosystem.com/<span className="text-blue-600">{clinicSlug}</span>
            </p>
          </div>
        )}

        {/* Next Steps */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8 text-left">
          <h2 className="text-lg font-semibold text-blue-900 mb-4">
            <span aria-hidden="true">🚀</span> {t('auth.nextSteps')}
          </h2>
          <ol className="space-y-3 text-blue-800">
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                1
              </span>
              <span>{t('auth.nextStepLogin')}</span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                2
              </span>
              <span>{t('auth.nextStepConfigureClinic')}</span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                3
              </span>
              <span>{t('auth.nextStepAddDoctors')}</span>
            </li>
          </ol>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <Link
            to="/login"
            className="block w-full py-3 px-4 text-center font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            {t('auth.goToLoginButton')}
          </Link>
          <Link
            to="/"
            className="block w-full py-3 px-4 text-center font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t('auth.backToHome')}
          </Link>
        </div>

        {/* Help */}
        <p className="mt-8 text-sm text-gray-500">
          {t('auth.needHelp')}{' '}
          <a href="mailto:soporte@alveosystem.com" className="text-blue-600 hover:underline">
            {t('auth.contactUs')}
          </a>
        </p>
      </div>
    </div>
  )
}
