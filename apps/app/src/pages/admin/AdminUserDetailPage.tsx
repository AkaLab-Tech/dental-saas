import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { adminUsersApi, type AdminUserDetail } from '@/lib/admin-api'
import { roleColors } from '@/lib/admin-utils'
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  Shield,
  Key,
} from 'lucide-react'

export function AdminUserDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    const fetchUser = async () => {
      try {
        setIsLoading(true)
        const data = await adminUsersApi.get(id)
        setUser(data)
        setError(null)
      } catch {
        setError(t('admin.userDetail.loadError'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchUser()
  }, [id, t])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-600 font-medium">{error || t('admin.userDetail.notFound')}</p>
          <Link
            to="/admin/users"
            className="text-red-600 hover:text-red-700 underline text-sm mt-1 inline-block"
          >
            {t('admin.userDetail.backToUsers')}
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
          onClick={() => navigate('/admin/users')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-lg font-medium text-gray-600">
                {user.firstName?.[0]}{user.lastName?.[0]}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {user.firstName} {user.lastName}
              </h1>
              <p className="text-gray-500">{user.email}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-800'}`}>
            {t(`admin.roles.${user.role}`)}
          </span>
          {user.isActive ? (
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
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.userDetail.contactInfoHeading')}</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-gray-600">
                <Mail className="h-5 w-5 text-gray-400" />
                <span>{user.email}</span>
              </div>
              {user.phone && (
                <div className="flex items-center gap-3 text-gray-600">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <span>{user.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tenant Information */}
          {user.tenant && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.userDetail.tenantHeading')}</h2>
              <Link
                to={`/admin/tenants/${user.tenant.id}`}
                className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{user.tenant.name}</p>
                  <p className="text-sm text-gray-500">/{user.tenant.slug}</p>
                </div>
              </Link>
            </div>
          )}

          {/* Account Details */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.userDetail.accountDetailsHeading')}</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-gray-600">
                <Shield className="h-5 w-5 text-gray-400" />
                <span>{t('admin.userDetail.roleLabel', { role: t(`admin.roles.${user.role}`) })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Mail className="h-5 w-5 text-gray-400" />
                <span>{t('admin.userDetail.emailVerifiedLabel', { value: user.emailVerified ? t('admin.userDetail.yes') : t('admin.userDetail.no') })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Key className="h-5 w-5 text-gray-400" />
                <span>{t('admin.userDetail.activeSessionsLabel', { count: user._count.refreshTokens })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Calendar className="h-5 w-5 text-gray-400" />
                <span>{t('admin.userDetail.createdLabel', {
                  date: new Date(user.createdAt).toLocaleString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Clock className="h-5 w-5 text-gray-400" />
                <span>{t('admin.userDetail.updatedLabel', {
                  date: new Date(user.updatedAt).toLocaleString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}</span>
              </div>
              {user.lastLoginAt && (
                <div className="flex items-center gap-3 text-gray-600">
                  <Clock className="h-5 w-5 text-gray-400" />
                  <span>{t('admin.userDetail.lastLoginLabel', {
                    date: new Date(user.lastLoginAt).toLocaleString(i18n.language, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.userDetail.statusHeading')}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{t('admin.userDetail.accountLabel')}</span>
                {user.isActive ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3" />
                    {t('admin.userDetail.accountActive')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    <XCircle className="h-3 w-3" />
                    {t('admin.userDetail.accountSuspended')}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{t('admin.common.email')}</span>
                {user.emailVerified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3" />
                    {t('admin.userDetail.verified')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    <AlertCircle className="h-3 w-3" />
                    {t('admin.userDetail.unverified')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.userDetail.idHeading')}</h2>
            <p className="text-xs font-mono text-gray-500 break-all">{user.id}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminUserDetailPage
