import { useEffect } from 'react'
import { Link } from 'react-router'
import {
  Users,
  Stethoscope,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  FlaskConical,
  AlertCircle,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts'
import { useStatsStore } from '@/stores/stats.store'
import { useAuthStore } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'
import { UserRole } from '@dental/shared'
import { formatCurrency } from '@/lib/format'
import DoctorDashboard from './DoctorDashboard'

// ============================================================================
// Stat Card Component
// ============================================================================

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  linkTo?: string
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red'
}

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
}

function StatCard({ title, value, subtitle, icon, trend, linkTo, color }: StatCardProps) {
  const content = (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          {trend && (
            <div className={`mt-2 flex items-center text-sm ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.isPositive ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
              {trend.isPositive ? '+' : ''}{trend.value}% vs mes anterior
            </div>
          )}
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
// Dashboard Page
// ============================================================================

export default function DashboardPage() {
  const { overview, appointmentStats, revenueStats, patientsGrowth, doctorPerformance, isLoading, error, fetchAllStats } = useStatsStore()
  const { user } = useAuthStore()
  const activeUser = useLockStore((s) => s.activeUser)
  const effectiveRole = activeUser?.role || user?.role
  const isDoctorOrStaff = effectiveRole === UserRole.DOCTOR || effectiveRole === UserRole.STAFF

  // Admin/owner stats — skip the fetch for doctor/staff, who render DoctorDashboard.
  useEffect(() => {
    if (!isDoctorOrStaff) {
      fetchAllStats()
    }
  }, [fetchAllStats, isDoctorOrStaff])

  // Show doctor dashboard for DOCTOR and STAFF roles
  if (isDoctorOrStaff) {
    return <DoctorDashboard />
  }

  const currency = user?.tenant?.currency || 'USD'
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN || user?.role === UserRole.CLINIC_ADMIN

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

  // Prepare chart data for appointments by day
  const appointmentChartData = appointmentStats?.byDay.slice(-14).map(item => ({
    date: new Date(item.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
    citas: item.count,
  })) || []

  // Prepare chart data for revenue by month
  const revenueChartData = revenueStats?.byMonth.map(item => ({
    month: item.month,
    ingresos: item.revenue,
  })) || []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500">
            Bienvenido, {user?.firstName}. Aquí está el resumen de tu clínica.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Pacientes Activos"
          value={overview?.totalPatients || 0}
          icon={<Users className="h-6 w-6" />}
          color="blue"
          linkTo="/patients"
          trend={patientsGrowth ? {
            value: patientsGrowth.growthPercentage,
            isPositive: patientsGrowth.growthPercentage >= 0,
          } : undefined}
        />
        <StatCard
          title="Doctores"
          value={overview?.totalDoctors || 0}
          icon={<Stethoscope className="h-6 w-6" />}
          color="green"
          linkTo="/doctors"
        />
        <StatCard
          title="Citas del Mes"
          value={overview?.appointmentsThisMonth || 0}
          subtitle={`${overview?.completedAppointmentsThisMonth || 0} completadas`}
          icon={<Calendar className="h-6 w-6" />}
          color="purple"
          linkTo="/appointments"
        />
        <StatCard
          title="Ingresos del Mes"
          value={formatCurrency(overview?.monthlyRevenue || 0, currency)}
          subtitle={overview?.pendingPayments ? `${formatCurrency(overview.pendingPayments, currency)} pendientes` : undefined}
          icon={<DollarSign className="h-6 w-6" />}
          color="orange"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          title="Labworks Pendientes"
          value={overview?.pendingLabworks || 0}
          subtitle={overview?.unpaidLabworks ? `${overview.unpaidLabworks} sin pagar` : undefined}
          icon={<FlaskConical className="h-6 w-6" />}
          color="red"
          linkTo="/labworks"
        />
        <StatCard
          title="Total de Citas"
          value={overview?.totalAppointments || 0}
          subtitle="Histórico completo"
          icon={<Clock className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          title="Nuevos Pacientes (Mes)"
          value={patientsGrowth?.thisMonth || 0}
          subtitle={`${patientsGrowth?.lastMonth || 0} el mes pasado`}
          icon={<TrendingUp className="h-6 w-6" />}
          color="green"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Appointments Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Citas por Día (Últimos 14 días)</h3>
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
              No hay datos de citas para mostrar
            </div>
          )}
        </div>

        {/* Revenue Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Ingresos por Mes</h3>
          {revenueChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                <Tooltip formatter={(value) => [`$${value}`, 'Ingresos']} />
                <Line type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              No hay datos de ingresos para mostrar
            </div>
          )}
        </div>
      </div>

      {/* Doctor Performance Table (Admin only) */}
      {isAdmin && doctorPerformance && doctorPerformance.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Rendimiento de Doctores (Este Mes)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">Doctor</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">Citas</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">Completadas</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">Tasa</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {doctorPerformance.map((doctor) => (
                  <tr key={doctor.doctorId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{doctor.doctorName}</td>
                    <td className="py-3 px-4 text-center text-gray-600">{doctor.appointmentsCount}</td>
                    <td className="py-3 px-4 text-center text-gray-600">{doctor.completedCount}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${doctor.completionRate >= 80 ? 'bg-green-100 text-green-800' :
                          doctor.completionRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                        }`}>
                        {doctor.completionRate}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-900 font-medium">{formatCurrency(doctor.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Appointment Status Breakdown */}
      {appointmentStats && Object.keys(appointmentStats.byStatus).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Estado de Citas (Este Mes)</h3>
          <div className="flex flex-wrap gap-4">
            {Object.entries(appointmentStats.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
                <span className={`w-3 h-3 rounded-full ${status === 'COMPLETED' ? 'bg-green-500' :
                    status === 'SCHEDULED' ? 'bg-blue-500' :
                      status === 'CONFIRMED' ? 'bg-purple-500' :
                        status === 'CANCELLED' ? 'bg-red-500' :
                          status === 'NO_SHOW' ? 'bg-orange-500' :
                            'bg-gray-500'
                  }`} />
                <span className="text-sm text-gray-600">{status}</span>
                <span className="text-sm font-semibold text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
