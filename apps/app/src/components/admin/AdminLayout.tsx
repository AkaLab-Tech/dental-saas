import { Navigate, Outlet, Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '@/stores/admin.store'
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  Shield,
} from 'lucide-react'

export function AdminLayout() {
  const { t } = useTranslation()
  const { isAuthenticated, superAdmin, logout } = useAdminStore()
  const location = useLocation()

  const navItems = [
    { path: '/admin/dashboard', label: t('admin.layout.navDashboard'), icon: LayoutDashboard },
    { path: '/admin/tenants', label: t('admin.layout.navTenants'), icon: Building2 },
    { path: '/admin/users', label: t('admin.layout.navUsers'), icon: Users },
  ]

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />
  }

  const handleLogout = () => {
    logout()
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 bg-gray-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-800">
          <Shield className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-lg font-bold">Alveo System</h1>
            <p className="text-xs text-gray-400">{t('admin.common.superAdminPanelSubtitle')}</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-6 px-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User info & Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 px-2 mb-3">
            <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-sm font-medium">
                {superAdmin?.firstName?.[0]}{superAdmin?.lastName?.[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {superAdmin?.firstName} {superAdmin?.lastName}
              </p>
              <p className="text-xs text-gray-400 truncate">{superAdmin?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t('admin.layout.logout')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 p-8">
        <Outlet />
      </main>
    </div>
  )
}

export default AdminLayout
