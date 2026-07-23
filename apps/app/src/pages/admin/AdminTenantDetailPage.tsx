import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { adminTenantsApi, type TenantDetail } from '@/lib/admin-api'
import {
  Building2,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Globe,
  Calendar,
  Users,
  User,
  Stethoscope,
  CalendarDays,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
} from 'lucide-react'

export function AdminTenantDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    const fetchTenant = async () => {
      try {
        setIsLoading(true)
        const data = await adminTenantsApi.get(id)
        setTenant(data)
        setError(null)
      } catch {
        setError(t('admin.tenantDetail.loadError'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchTenant()
  }, [id, t])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !tenant) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-600 font-medium">{error || t('admin.tenantDetail.notFound')}</p>
          <Link
            to="/admin/tenants"
            className="text-red-600 hover:text-red-700 underline text-sm mt-1 inline-block"
          >
            {t('admin.tenantDetail.backToTenants')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/admin/tenants')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
              <p className="text-gray-500">/{tenant.slug}</p>
            </div>
          </div>
        </div>
        <div>
          {tenant.isActive ? (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
              <CheckCircle className="h-4 w-4" />
              {t('admin.status.active')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-800">
              <XCircle className="h-4 w-4" />
              {t('admin.status.suspended')}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact Information */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.tenantDetail.contactInfoHeading')}</h2>
            <div className="space-y-3">
              {tenant.email && (
                <div className="flex items-center gap-3 text-gray-600">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <span>{tenant.email}</span>
                </div>
              )}
              {tenant.phone && (
                <div className="flex items-center gap-3 text-gray-600">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <span>{tenant.phone}</span>
                </div>
              )}
              {tenant.address && (
                <div className="flex items-center gap-3 text-gray-600">
                  <MapPin className="h-5 w-5 text-gray-400" />
                  <span>{tenant.address}</span>
                </div>
              )}
            </div>
          </div>

          {/* Settings */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.tenantDetail.settingsHeading')}</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-gray-600">
                <Globe className="h-5 w-5 text-gray-400" />
                <span>{t('admin.tenantDetail.timezoneLabel', { timezone: tenant.timezone })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <DollarSign className="h-5 w-5 text-gray-400" />
                <span>{t('admin.tenantDetail.currencyLabel', { currency: tenant.currency })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Calendar className="h-5 w-5 text-gray-400" />
                <span>{t('admin.tenantDetail.createdLabel', {
                  date: new Date(tenant.createdAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Clock className="h-5 w-5 text-gray-400" />
                <span>{t('admin.tenantDetail.updatedLabel', {
                  date: new Date(tenant.updatedAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                })}</span>
              </div>
            </div>
          </div>

          {/* Users */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.tenantDetail.usersHeading', { count: tenant.users.length })}</h2>
            {tenant.users.length === 0 ? (
              <p className="text-gray-500 text-sm">{t('admin.tenantDetail.usersEmpty')}</p>
            ) : (
              <div className="space-y-3">
                {tenant.users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600">
                          {user.firstName?.[0]}{user.lastName?.[0]}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                        {t(`admin.roles.${user.role}`)}
                      </span>
                      {user.isActive ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Statistics Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.tenantDetail.statisticsHeading')}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-blue-600" />
                  <span className="text-sm text-gray-700">{t('admin.tenantDetail.statUsers')}</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">{tenant.users.length}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Stethoscope className="h-5 w-5 text-green-600" />
                  <span className="text-sm text-gray-700">{t('admin.tenantDetail.statDoctors')}</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">{tenant._count.doctors}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-purple-600" />
                  <span className="text-sm text-gray-700">{t('admin.tenantDetail.statPatients')}</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">{tenant._count.patients}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-5 w-5 text-orange-600" />
                  <span className="text-sm text-gray-700">{t('admin.tenantDetail.statAppointments')}</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">{tenant._count.appointments}</span>
              </div>
            </div>
          </div>

          {/* Subscription */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.tenantDetail.subscriptionHeading')}</h2>
            <p className="text-2xl font-bold text-blue-600">
              {tenant.subscription?.plan?.displayName || t('admin.tenantDetail.noPlan')}
            </p>
            {tenant.subscription?.plan && (
              <p className="text-sm text-gray-500 mt-1">
                {t('admin.tenantDetail.planName', { name: tenant.subscription.plan.name })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminTenantDetailPage
