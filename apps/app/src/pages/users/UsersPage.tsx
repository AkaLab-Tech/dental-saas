import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, AlertCircle, Users, Loader2, X, MoreVertical, Shield } from 'lucide-react'
import { Permission } from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  listUsers,
  createUser,
  updateUser,
  updateUserRole,
  deleteUser,
  getUserStats,
  type UserProfile,
  type CreateUserData,
  type CreateProfileData,
  type UserStats,
} from '@/lib/users-api'

// ---------------------------------------------------------------------------
// Role badge styling
// ---------------------------------------------------------------------------
const ROLE_STYLES: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  CLINIC_ADMIN: 'bg-indigo-100 text-indigo-700',
  DOCTOR: 'bg-green-100 text-green-700',
  STAFF: 'bg-gray-100 text-gray-700',
}

const ASSIGNABLE_ROLES = ['ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'] as const

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  CLINIC_ADMIN: 'Clinic Admin',
  DOCTOR: 'Doctor',
  STAFF: 'Staff',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function UsersPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const currentUser = useAuthStore((s) => s.user)
  const fetchProfiles = useLockStore((s) => s.fetchProfiles)

  // Data
  const [users, setUsers] = useState<UserProfile[]>([])
  const [stats, setStats] = useState<UserStats | null>(null)

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Create form
  const [profileOnly, setProfileOnly] = useState(true)
  const [form, setForm] = useState<CreateUserData>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'STAFF',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)
      const [usersList, userStats] = await Promise.all([
        listUsers(),
        getUserStats(),
      ])
      setUsers(usersList)
      setStats(userStats)
      setError(null)
    } catch {
      setError(t('users.fetchError'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Clear success message after 3s
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  // Close dropdown on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const resetForm = () => {
    setProfileOnly(true)
    setForm({ firstName: '', lastName: '', email: '', password: '', role: 'STAFF' })
    setFormError(null)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName) {
      setFormError(t('users.requiredFields'))
      return
    }
    if (!profileOnly && (!form.email || !form.password)) {
      setFormError(t('users.requiredFields'))
      return
    }
    setIsSubmitting(true)
    setFormError(null)
    try {
      const payload: CreateUserData | CreateProfileData = profileOnly
        ? { profileOnly: true, firstName: form.firstName, lastName: form.lastName, role: form.role }
        : form
      await createUser(payload)
      setShowCreateModal(false)
      resetForm()
      setSuccessMessage(t('users.createSuccess'))
      await fetchData()
      fetchProfiles()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('users.createError')
      setFormError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleActive = async (user: UserProfile) => {
    try {
      await updateUser(user.id, { isActive: !user.isActive })
      setSuccessMessage(user.isActive ? t('users.deactivated') : t('users.reactivated'))
      await fetchData()
      fetchProfiles()
    } catch {
      setError(t('users.updateError'))
    }
  }

  const handleRoleChange = async (user: UserProfile, role: string) => {
    try {
      await updateUserRole(user.id, role)
      setSuccessMessage(t('users.roleUpdated'))
      await fetchData()
      fetchProfiles()
    } catch {
      setError(t('users.updateError'))
    }
  }

  const handleConfirmDelete = async () => {
    if (!userToDelete) return
    setIsDeleting(true)
    try {
      await deleteUser(userToDelete.id)
      setSuccessMessage(t('users.deleteSuccess'))
      setUserToDelete(null)
      await fetchData()
      fetchProfiles()
    } catch {
      setError(t('users.deleteError'))
    } finally {
      setIsDeleting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('users.title')}</h1>
          <p className="text-gray-600 mt-1">{t('users.subtitle')}</p>
        </div>
        {can(Permission.USERS_CREATE) && (
          <button
            onClick={() => { resetForm(); setShowCreateModal(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            {t('users.newUser')}
          </button>
        )}
      </div>

      {/* Plan limits bar */}
      {stats && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            <span className="text-sm text-gray-600">{t('users.planLimits')}:</span>
          </div>
          <span className="text-sm font-medium text-gray-700">
            {t('users.admins')}: {stats.counts['ADMIN'] || 0}/{stats.limits.maxAdmins}
          </span>
          <span className="text-sm font-medium text-gray-700">
            {t('users.doctors')}: {stats.counts['DOCTOR'] || 0}/{stats.limits.maxDoctors}
          </span>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          {successMessage}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-800 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && users.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && users.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 shadow-sm">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">{t('users.noUsers')}</h3>
          <p className="text-gray-600 mt-1">{t('users.createFirst')}</p>
        </div>
      )}

      {/* Users table */}
      {users.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('users.name')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">{t('users.email')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('users.role')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">{t('users.pinStatus')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">{t('users.status')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">{t('users.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id
                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell max-w-[200px] truncate">
                      {user.email.endsWith('@noreply.internal') ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          {t('users.profileOnlyBadge')}
                        </span>
                      ) : (
                        user.email
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[user.role] || ROLE_STYLES.STAFF}`}>
                        {ROLE_LABELS[user.role] || user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${user.hasPinSet ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {user.hasPinSet ? t('users.pinSet') : t('users.pinNotSet')}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {user.isActive ? t('users.active') : t('users.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && can(Permission.USERS_UPDATE) && (
                        <div className="relative inline-block">
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === user.id ? null : user.id) }}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {openMenuId === user.id && (
                            <div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                              {/* Role change */}
                              {ASSIGNABLE_ROLES.filter((r) => r !== user.role).map((role) => (
                                <button
                                  key={role}
                                  onClick={() => { handleRoleChange(user, role); setOpenMenuId(null) }}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  {t('users.editRole')}: {ROLE_LABELS[role] || role}
                                </button>
                              ))}
                              <hr className="my-1 border-gray-100" />
                              {/* Toggle active */}
                              <button
                                onClick={() => { handleToggleActive(user); setOpenMenuId(null) }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                {user.isActive ? t('users.deactivate') : t('users.reactivate')}
                              </button>
                              {/* Delete */}
                              {can(Permission.USERS_DELETE) && (
                                <>
                                  <hr className="my-1 border-gray-100" />
                                  <button
                                    onClick={() => { setUserToDelete(user); setOpenMenuId(null) }}
                                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    {t('users.delete')}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create user modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCreateModal(false)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="relative w-full max-w-md bg-white rounded-xl shadow-xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {profileOnly ? t('users.createProfileTitle') : t('users.createTitle')}
              </h2>

              {/* Profile / User toggle — Profile is default (switch OFF), User is switch ON */}
              <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                <span className={`text-sm font-medium ${profileOnly ? 'text-blue-700' : 'text-gray-500'}`}>
                  {t('users.modeProfile')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!profileOnly}
                  onClick={() => setProfileOnly(!profileOnly)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${!profileOnly ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${!profileOnly ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className={`text-sm font-medium ${!profileOnly ? 'text-blue-700' : 'text-gray-500'}`}>
                  {t('users.modeUser')}
                </span>
              </div>

              {profileOnly && (
                <p className="text-xs text-gray-500 mb-4">{t('users.profileDescription')}</p>
              )}

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.firstName')}</label>
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.lastName')}</label>
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                {!profileOnly && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.email')}</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.password')}</label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                        minLength={8}
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.selectRole')}</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as CreateUserData['role'] }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {profileOnly ? t('users.createProfile') : t('users.newUser')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('users.delete')}
        message={t('users.deleteConfirm', {
          name: `${userToDelete?.firstName} ${userToDelete?.lastName}`,
        })}
        confirmText={t('users.delete')}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}
