import { Navigate, Outlet, Link, useLocation } from 'react-router'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api'
import {
  LayoutDashboard,
  Stethoscope,
  Users,
  Calendar,
  FlaskConical,
  Receipt,
  Wallet,
  Settings,
  Shield,
  Lock,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { useLockStore } from '@/stores/lock.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useInactivityTimer } from '@/hooks/useInactivityTimer'
import { LockScreen } from '@/components/auth/LockScreen'
import { PinSetupModal } from '@/components/auth/PinSetupModal'

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  CLINIC_ADMIN: 'Clinic Admin',
  DOCTOR: 'Doctor',
  STAFF: 'Staff',
}

const navItems = [
  { path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/doctors', labelKey: 'nav.doctors', icon: Stethoscope, permission: Permission.DOCTORS_CREATE },
  { path: '/patients', labelKey: 'nav.patients', icon: Users, permission: Permission.PATIENTS_VIEW },
  { path: '/patients/debts', labelKey: 'nav.debtors', icon: Wallet, permission: Permission.PAYMENTS_VIEW },
  { path: '/appointments', labelKey: 'nav.appointments', icon: Calendar, permission: Permission.APPOINTMENTS_VIEW },
  { path: '/labworks', labelKey: 'nav.labworks', icon: FlaskConical, permission: Permission.LABWORKS_VIEW },
  { path: '/expenses', labelKey: 'nav.expenses', icon: Receipt, permission: Permission.EXPENSES_CREATE },
  { path: '/users', labelKey: 'nav.users', icon: Shield, permission: Permission.USERS_CREATE },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings, permission: Permission.SETTINGS_UPDATE },
]

export function AppLayout() {
  const { t } = useTranslation()
  const { isAuthenticated, user, logout, refreshToken } = useAuthStore()
  const { can } = usePermissions()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isLocked = useLockStore((s) => s.isLocked)
  const setAutoLockMinutes = useLockStore((s) => s.setAutoLockMinutes)
  const autoLockMinutes = useLockStore((s) => s.autoLockMinutes)
  const fetchProfiles = useLockStore((s) => s.fetchProfiles)
  const activeUser = useLockStore((s) => s.activeUser)
  const settings = useSettingsStore((s) => s.settings)
  const fetchSettings = useSettingsStore((s) => s.fetchSettings)

  useInactivityTimer()

  // Sync autoLockMinutes from tenant settings
  useEffect(() => {
    if (!settings) {
      fetchSettings()
    }
  }, [settings, fetchSettings])

  useEffect(() => {
    if (settings?.autoLockMinutes !== undefined) {
      setAutoLockMinutes(settings.autoLockMinutes)
    }
  }, [settings?.autoLockMinutes, setAutoLockMinutes])

  // Fetch profiles when auto-lock is enabled
  useEffect(() => {
    if (autoLockMinutes > 0) {
      fetchProfiles()
    }
  }, [autoLockMinutes, fetchProfiles])

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Show lock screen when locked
  if (isLocked) {
    return <LockScreen />
  }

  // Show PIN setup modal when auto-lock is enabled but user has no PIN
  const showPinSetup = autoLockMinutes > 0 && user?.hasPinSet === false

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken)
      }
    } catch {
      // Ignore logout API errors
    } finally {
      logout()
    }
  }

  const handleLock = () => {
    if (autoLockMinutes > 0) {
      useLockStore.getState().lock()
    }
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Alveo</h1>
              <p className="text-xs text-gray-500">
                {user?.tenant?.name || 'Dental Clinic'}
              </p>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="lg:hidden p-1 text-gray-500 hover:text-gray-700"
            aria-label={t('nav.closeMenu')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="mt-6 px-4">
          <ul className="space-y-1">
            {navItems.filter((item) => !item.permission || can(item.permission)).map((item) => {
              const isActive =
                item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path)
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={closeSidebar}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                  >
                    <item.icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : ''}`} />
                    {t(item.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User info & Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-2 mb-3">
            <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-sm font-medium text-white">
                {(activeUser?.firstName ?? user?.firstName)?.[0]}
                {(activeUser?.lastName ?? user?.lastName)?.[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {activeUser?.firstName ?? user?.firstName} {activeUser?.lastName ?? user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {activeUser ? (ROLE_LABELS[activeUser.role] || activeUser.role) : user?.email}
              </p>
            </div>
          </div>
          {autoLockMinutes > 0 && (
            <button
              onClick={handleLock}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors"
            >
              <Lock className="h-4 w-4" />
              {t('nav.lock')}
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ml-64">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              aria-label={t('nav.openMenu')}
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">A</span>
              </div>
              <span className="font-semibold text-gray-900">Alveo</span>
            </div>
            <div className="w-10" /> {/* Spacer for centering */}
          </div>
        </header>

        {/* Page content */}
        <main className="p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {showPinSetup && <PinSetupModal />}
    </div>
  )
}

export default AppLayout
