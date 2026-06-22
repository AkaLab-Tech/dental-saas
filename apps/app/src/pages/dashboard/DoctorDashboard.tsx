import { useEffect } from 'react'
import { Link } from 'react-router'
import {
  Users,
  Calendar,
  DollarSign,
  Clock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useStatsStore } from '@/stores/stats.store'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { useTranslation } from 'react-i18next'

// ============================================================================
// Stat Card (reused pattern from DashboardPage)
// ============================================================================

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
}

function StatCard({ title, value, subtitle, icon, linkTo, color }: {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  linkTo?: string
  color: 'blue' | 'green' | 'purple' | 'orange'
}) {
  const content = (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )

  if (linkTo) {
    return <Link to={linkTo} className="block">{content}</Link>
  }

  return content
}

// ============================================================================
// Status badge helper
// ============================================================================

const statusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-800',
  CONFIRMED: 'bg-purple-100 text-purple-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  NO_SHOW: 'bg-orange-100 text-orange-800',
}

const statusDotColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-500',
  CONFIRMED: 'bg-purple-500',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-red-500',
  NO_SHOW: 'bg-orange-500',
}

// ============================================================================
// Doctor Dashboard
// ============================================================================

export default function DoctorDashboard() {
  const { t } = useTranslation()
  const { overview, appointmentStats, upcomingAppointments, appointmentTypes, myDoctorId, isLoading, error, fetchMyDoctorId, fetchDoctorStats } = useStatsStore()
  const { user } = useAuthStore()
  const currency = user?.tenant?.currency || 'USD'

  useEffect(() => {
    const loadDoctorStats = async () => {
      const doctorId = await fetchMyDoctorId()
      if (doctorId) {
        fetchDoctorStats(doctorId)
      }
    }
    loadDoctorStats()
  }, [fetchMyDoctorId, fetchDoctorStats])

  if (isLoading && !overview) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 m-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-red-600" />
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    )
  }

  if (myDoctorId === null && !isLoading) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-amber-600" />
            <p className="text-amber-800">{t('dashboard.doctor.notLinked')}</p>
          </div>
        </div>
      </div>
    )
  }

  // Chart data
  const appointmentChartData = appointmentStats?.byDay.slice(-14).map(item => ({
    date: new Date(item.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
    citas: item.count,
  })) || []

  const typeChartData = appointmentTypes?.slice(0, 8) || []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.doctor.title')}</h1>
        <p className="text-gray-500">
          {t('dashboard.doctor.welcome', { name: user?.firstName })}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title={t('dashboard.doctor.monthAppointments')}
          value={overview?.appointmentsThisMonth || 0}
          subtitle={`${overview?.completedAppointmentsThisMonth || 0} ${t('dashboard.doctor.completed')}`}
          icon={<Calendar className="h-6 w-6" />}
          color="purple"
          linkTo="/appointments"
        />
        <StatCard
          title={t('dashboard.doctor.patientsAttended')}
          value={overview?.totalPatients || 0}
          icon={<Users className="h-6 w-6" />}
          color="blue"
          linkTo="/patients"
        />
        <StatCard
          title={t('dashboard.doctor.upcomingCount')}
          value={upcomingAppointments?.length || 0}
          icon={<Clock className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          title={t('dashboard.doctor.monthRevenue')}
          value={formatCurrency(overview?.monthlyRevenue || 0, currency)}
          icon={<DollarSign className="h-6 w-6" />}
          color="orange"
        />
      </div>

      {/* Main content: Upcoming + Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Appointments */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.doctor.upcoming')}</h3>
          {upcomingAppointments && upcomingAppointments.length > 0 ? (
            <div className="space-y-3">
              {upcomingAppointments.map((apt) => (
                <Link
                  key={apt.id}
                  to={`/appointments`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{apt.patientName}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(apt.startTime).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' '}
                      {new Date(apt.startTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      {' - '}
                      {new Date(apt.endTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {apt.type && (
                      <p className="text-xs text-gray-400 mt-0.5">{apt.type}</p>
                    )}
                  </div>
                  <span className={`ml-3 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[apt.status] || 'bg-gray-100 text-gray-800'}`}>
                    {apt.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-gray-400">
              <CheckCircle2 className="h-10 w-10 mb-2" />
              <p className="text-sm">{t('dashboard.doctor.noUpcoming')}</p>
            </div>
          )}
        </div>

        {/* Appointments by Day Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.doctor.appointmentsByDay')}</h3>
          {appointmentChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={appointmentChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="citas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              {t('dashboard.doctor.noAppointmentData')}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Procedure types + Status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Procedure Types */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.doctor.procedureTypes')}</h3>
          {typeChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={typeChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis dataKey="type" type="category" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              {t('dashboard.doctor.noProcedureData')}
            </div>
          )}
        </div>

        {/* Appointment Status Breakdown */}
        {appointmentStats && Object.keys(appointmentStats.byStatus).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.doctor.appointmentStatus')}</h3>
            <div className="flex flex-wrap gap-4">
              {Object.entries(appointmentStats.byStatus).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
                  <span className={`w-3 h-3 rounded-full ${statusDotColors[status] || 'bg-gray-500'}`} />
                  <span className="text-sm text-gray-600">{status}</span>
                  <span className="text-sm font-semibold text-gray-900">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
