import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { adminUsersApi, type AdminUser, type UsersListResponse } from '@/lib/admin-api'
import { roleColors } from '@/lib/admin-utils'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Power,
  Trash2,
  Eye,
  Key,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Building2,
} from 'lucide-react'

export function AdminUsersPage() {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<UsersListResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')
  const [role, setRole] = useState<string>('')
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number; openUpward: boolean } | null>(null)
  const [resetPasswordModal, setResetPasswordModal] = useState<{ userId: string; email: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await adminUsersApi.list({
        page,
        limit: 10,
        search: search || undefined,
        status: status || undefined,
        role: role || undefined,
      })
      setData(response)
      setError(null)
    } catch {
      setError(t('admin.users.loadError'))
    } finally {
      setIsLoading(false)
    }
  }, [page, search, status, role, t])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchUsers()
  }

  const handleToggleStatus = async (user: AdminUser) => {
    setActionLoading(user.id)
    try {
      if (user.isActive) {
        await adminUsersApi.suspend(user.id)
      } else {
        await adminUsersApi.activate(user.id)
      }
      fetchUsers()
    } catch {
      setError(t('admin.users.toggleStatusError'))
    } finally {
      setActionLoading(null)
      setOpenMenu(null)
      setDropdownPosition(null)
    }
  }

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(t('admin.users.deleteConfirm', { name: `${user.firstName} ${user.lastName}` }))) {
      return
    }

    setActionLoading(user.id)
    try {
      await adminUsersApi.delete(user.id)
      fetchUsers()
    } catch {
      setError(t('admin.users.deleteError'))
    } finally {
      setActionLoading(null)
      setOpenMenu(null)
      setDropdownPosition(null)
    }
  }

  const handleResetPassword = async () => {
    if (!resetPasswordModal || !newPassword) return

    setActionLoading(resetPasswordModal.userId)
    try {
      await adminUsersApi.resetPassword(resetPasswordModal.userId, newPassword)
      setResetPasswordModal(null)
      setNewPassword('')
      setPasswordError(null)
    } catch {
      setPasswordError(t('admin.users.resetPasswordError'))
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.users.title')}</h1>
          <p className="text-gray-500">{t('admin.users.subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.users.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('admin.status.all')}</option>
            <option value="active">{t('admin.status.activeFilter')}</option>
            <option value="inactive">{t('admin.status.inactiveFilter')}</option>
          </select>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value)
              setPage(1)
            }}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('admin.users.allRoles')}</option>
            <option value="SUPER_ADMIN">{t('admin.roles.SUPER_ADMIN')}</option>
            <option value="OWNER">{t('admin.roles.OWNER')}</option>
            <option value="ADMIN">{t('admin.roles.ADMIN')}</option>
            <option value="CLINIC_ADMIN">{t('admin.roles.CLINIC_ADMIN')}</option>
            <option value="DOCTOR">{t('admin.roles.DOCTOR')}</option>
            <option value="STAFF">{t('admin.roles.STAFF')}</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('admin.users.searchButton')}
          </button>
        </form>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      )}

      {/* Table */}
      {!isLoading && data && (
        <>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.users.tableHeaderUser')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.users.tableHeaderRole')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.users.tableHeaderStatus')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.users.tableHeaderTenant')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.users.tableHeaderLastLogin')}
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">{t('admin.users.tableHeaderActionsSr')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      {t('admin.users.emptyState')}
                    </td>
                  </tr>
                ) : (
                  data.users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
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
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-800'}`}>
                          {t(`admin.roles.${user.role}`)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircle className="h-3 w-3" />
                            {t('admin.status.active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            <XCircle className="h-3 w-3" />
                            {t('admin.status.suspended')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {user.tenant ? (
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-900">{user.tenant.name}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString(i18n.language, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                          : t('admin.users.never')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              if (openMenu === user.id) {
                                setOpenMenu(null)
                                setDropdownPosition(null)
                              } else {
                                const button = e.currentTarget
                                const rect = button.getBoundingClientRect()
                                const viewportHeight = window.innerHeight
                                const viewportWidth = window.innerWidth
                                const dropdownHeight = 160 // approximate height of menu

                                const shouldOpenUpward = rect.bottom + dropdownHeight > viewportHeight
                                const top = shouldOpenUpward ? rect.top - dropdownHeight : rect.bottom
                                const right = viewportWidth - rect.right

                                setDropdownPosition({ top, right, openUpward: shouldOpenUpward })
                                setOpenMenu(user.id)
                              }
                            }}
                            className="p-2 hover:bg-gray-100 rounded-lg"
                            disabled={actionLoading === user.id || user.role === 'SUPER_ADMIN'}
                          >
                            {actionLoading === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreVertical className="h-4 w-4 text-gray-400" />
                            )}
                          </button>

                          {openMenu === user.id && user.role !== 'SUPER_ADMIN' && dropdownPosition && (
                            <>
                              <div
                                className="fixed inset-0 z-0"
                                onClick={() => {
                                  setOpenMenu(null)
                                  setDropdownPosition(null)
                                }}
                              />
                              <div
                                className="fixed w-48 bg-white rounded-lg shadow-lg border z-10"
                                style={{
                                  top: `${dropdownPosition.top}px`,
                                  right: `${dropdownPosition.right}px`,
                                }}
                              >
                                <Link
                                  to={`/admin/users/${user.id}`}
                                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => {
                                    setOpenMenu(null)
                                    setDropdownPosition(null)
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                  {t('admin.users.viewDetails')}
                                </Link>
                                <button
                                  onClick={() => {
                                    setResetPasswordModal({ userId: user.id, email: user.email })
                                    setOpenMenu(null)
                                    setDropdownPosition(null)
                                  }}
                                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <Key className="h-4 w-4" />
                                  {t('admin.users.resetPasswordAction')}
                                </button>
                                <button
                                  onClick={() => handleToggleStatus(user)}
                                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <Power className="h-4 w-4" />
                                  {user.isActive ? t('admin.users.suspendAction') : t('admin.users.activateAction')}
                                </button>
                                <button
                                  onClick={() => handleDelete(user)}
                                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {t('admin.users.deleteAction')}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-gray-500">
                {t('admin.users.paginationShowing', {
                  from: (page - 1) * 10 + 1,
                  to: Math.min(page * 10, data.pagination.total),
                  total: data.pagination.total,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-4 py-2 text-sm">
                  {t('admin.users.paginationPage', { page, totalPages: data.pagination.totalPages })}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === data.pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Reset Password Modal */}
      {resetPasswordModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            setResetPasswordModal(null)
            setNewPassword('')
            setPasswordError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setResetPasswordModal(null)
              setNewPassword('')
              setPasswordError(null)
            }
          }}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t('admin.users.resetPasswordModalTitle')}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {t('admin.users.resetPasswordModalUser', { email: resetPasswordModal.email })}
            </p>
            <div className="mb-4">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder={t('admin.users.newPasswordPlaceholder')}
                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${newPassword.length > 0 && newPassword.length < 8
                    ? 'border-red-300'
                    : 'border-gray-200'
                  }`}
                autoFocus
              />
              {newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-sm text-red-600 mt-1">
                  {t('admin.users.passwordTooShort')}
                </p>
              )}
              {passwordError && (
                <p className="text-sm text-red-600 mt-1">{passwordError}</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setResetPasswordModal(null)
                  setNewPassword('')
                  setPasswordError(null)
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t('admin.users.cancel')}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={newPassword.length < 8 || actionLoading === resetPasswordModal.userId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading === resetPasswordModal.userId ? t('admin.users.resetPasswordSubmitting') : t('admin.users.resetPasswordSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminUsersPage
