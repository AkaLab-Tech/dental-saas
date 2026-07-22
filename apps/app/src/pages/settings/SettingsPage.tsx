import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Building2, Clock, Bell, Loader2, AlertCircle, CheckCircle2, Database } from 'lucide-react'
import { UserRole } from '@dental/shared'
import { useSettingsStore } from '@/stores/settings.store'
import { useAuthStore } from '@/stores/auth.store'
import { ClinicProfileForm } from '@/components/settings/ClinicProfileForm'
import { PreferencesForm } from '@/components/settings/PreferencesForm'
import { BusinessHoursForm } from '@/components/settings/BusinessHoursForm'
import { DataExportForm } from '@/components/settings/DataExportForm'

type TabId = 'profile' | 'preferences' | 'hours' | 'data'

interface Tab {
  id: TabId
  labelKey: string
  icon: typeof Settings
  descriptionKey: string
}

const tabs: Tab[] = [
  {
    id: 'profile',
    labelKey: 'settings.tabs.profile',
    icon: Building2,
    descriptionKey: 'settings.tabs.profileDescription',
  },
  {
    id: 'preferences',
    labelKey: 'settings.tabs.preferences',
    icon: Bell,
    descriptionKey: 'settings.tabs.preferencesDescription',
  },
  {
    id: 'hours',
    labelKey: 'settings.tabs.hours',
    icon: Clock,
    descriptionKey: 'settings.tabs.hoursDescription',
  },
  {
    id: 'data',
    labelKey: 'settings.tabs.data',
    icon: Database,
    descriptionKey: 'settings.tabs.dataDescription',
  },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    settings,
    tenantProfile,
    isLoading,
    error,
    successMessage,
    fetchAll,
    clearError,
    clearSuccessMessage,
  } = useSettingsStore()

  const [activeTab, setActiveTab] = useState<TabId>('profile')

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Auto-clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => clearSuccessMessage(), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage, clearSuccessMessage])

  const canEditProfile = user?.role === UserRole.OWNER
  const canEditSettings = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN

  if (isLoading && !settings && !tenantProfile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="h-7 w-7" />
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Success Alert */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="Tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-4 px-4 text-center border-b-2 font-medium text-sm transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className={`h-5 w-5 mx-auto mb-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className="hidden sm:block">{t(tab.labelKey)}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'profile' && (
            <ClinicProfileForm
              profile={tenantProfile}
              canEdit={canEditProfile}
            />
          )}
          {activeTab === 'preferences' && (
            <PreferencesForm
              settings={settings}
              canEdit={canEditSettings}
            />
          )}
          {activeTab === 'hours' && (
            <BusinessHoursForm
              settings={settings}
              canEdit={canEditSettings}
            />
          )}
          {activeTab === 'data' && canEditSettings && (
            <DataExportForm />
          )}
          {activeTab === 'data' && !canEditSettings && (
            <div className="text-center py-8 text-gray-500">
              {t('settings.noExportPermission')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
