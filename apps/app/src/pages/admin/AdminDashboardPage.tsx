import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminStatsApi, type PlatformStats, type TopTenant, type RecentActivity } from '@/lib/admin-api'
import {
  Building2,
  Users,
  UserCheck,
  CalendarDays,
  TrendingUp,
  Activity,
  Loader2,
  AlertCircle,
} from 'lucide-react'

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ElementType
  color: 'blue' | 'green' | 'purple' | 'orange'
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center gap-4">
        <div className={`${colorClasses[color]} p-3 rounded-lg`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}

export function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [topTenants, setTopTenants] = useState<TopTenant[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, tenantsData, activityData] = await Promise.all([
          adminStatsApi.getStats(),
          adminStatsApi.getTopTenants(),
          adminStatsApi.getRecentActivity(),
        ])
        setStats(statsData)
        setTopTenants(tenantsData)
        setRecentActivity(activityData)
      } catch {
        setError(t('admin.dashboard.loadError'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [t])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-start gap-3">
        <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0" />
        <div>
          <h3 className="font-medium text-red-800">{t('admin.dashboard.errorTitle')}</h3>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.dashboard.title')}</h1>
        <p className="text-gray-500">{t('admin.dashboard.subtitle')}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title={t('admin.dashboard.statTenantsTitle')}
          value={stats?.tenants.total || 0}
          subtitle={t('admin.dashboard.statTenantsSubtitle', { count: stats?.tenants.active || 0 })}
          icon={Building2}
          color="blue"
        />
        <StatCard
          title={t('admin.dashboard.statUsersTitle')}
          value={stats?.users.total || 0}
          subtitle={t('admin.dashboard.statUsersSubtitle', { count: stats?.users.active || 0 })}
          icon={Users}
          color="green"
        />
        <StatCard
          title={t('admin.dashboard.statPatientsTitle')}
          value={stats?.patients.total || 0}
          icon={UserCheck}
          color="purple"
        />
        <StatCard
          title={t('admin.dashboard.statAppointmentsTitle')}
          value={stats?.appointments.thisMonth || 0}
          subtitle={t('admin.dashboard.statAppointmentsSubtitle', { count: stats?.appointments.total || 0 })}
          icon={CalendarDays}
          color="orange"
        />
      </div>

      {/* Two Columns Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Tenants */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.topTenantsHeading')}</h2>
          </div>

          {topTenants.length === 0 ? (
            <p className="text-gray-500 text-sm">{t('admin.dashboard.topTenantsEmpty')}</p>
          ) : (
            <div className="space-y-4">
              {topTenants.map((tenant, index) => (
                <div key={tenant.id} className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-600">{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{tenant.name}</p>
                    <p className="text-sm text-gray-500">
                      {t('admin.dashboard.topTenantsStats', {
                        patients: tenant._count.patients,
                        appointments: tenant._count.appointments,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <Activity className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.recentActivityHeading')}</h2>
          </div>

          {recentActivity.length === 0 ? (
            <p className="text-gray-500 text-sm">{t('admin.dashboard.recentActivityEmpty')}</p>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-2 h-2 mt-2 rounded-full ${
                    activity.type === 'tenant_created' ? 'bg-blue-500' : 'bg-green-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      {activity.type === 'tenant_created' ? (
                        <>{t('admin.dashboard.activityNewTenant')} <span className="font-medium">{activity.name}</span></>
                      ) : (
                        <>{t('admin.dashboard.activityNewUser')} <span className="font-medium">{activity.email}</span>
                          {activity.tenantName && (
                            <span className="text-gray-500"> {t('admin.dashboard.activityInTenant', { tenantName: activity.tenantName })}</span>
                          )}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(activity.createdAt).toLocaleDateString(i18n.language, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Users by Role */}
      {stats?.users.byRole && (
        <div className="mt-8 bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.dashboard.usersByRoleHeading')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(stats.users.byRole).map(([role, count]) => (
              <div key={role} className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-sm text-gray-500">{t(`admin.roles.${role}`)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboardPage
