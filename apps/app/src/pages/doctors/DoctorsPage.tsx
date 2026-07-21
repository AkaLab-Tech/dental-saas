import { useEffect, useState, useCallback } from 'react'
import { Plus, Search, AlertCircle, Stethoscope, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDoctorsStore } from '@/stores/doctors.store'
import { DoctorsListView } from '@/components/doctors/DoctorsListView'
import { DoctorFormModal } from '@/components/doctors/DoctorFormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Doctor, CreateDoctorData } from '@/lib/doctor-api'

export function DoctorsPage() {
  const { t } = useTranslation()
  const {
    doctors,
    stats,
    isLoading,
    error,
    searchQuery,
    showInactive,
    fetchDoctors,
    fetchStats,
    addDoctor,
    editDoctor,
    removeDoctor,
    restoreDeletedDoctor,
    setSearchQuery,
    setShowInactive,
    clearError,
  } = useDoctorsStore()

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null)
  const [doctorToDelete, setDoctorToDelete] = useState<Doctor | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Fetch doctors on mount
  useEffect(() => {
    fetchDoctors()
    fetchStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDoctors()
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, showInactive])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleOpenCreate = () => {
    setSelectedDoctor(null)
    setIsFormOpen(true)
  }

  const handleEdit = (doctor: Doctor) => {
    setSelectedDoctor(doctor)
    setIsFormOpen(true)
  }

  const handleDelete = (doctor: Doctor) => {
    setDoctorToDelete(doctor)
  }

  const handleRestore = async (doctor: Doctor) => {
    try {
      await restoreDeletedDoctor(doctor.id)
      setSuccessMessage(t('doctors.toast.restored', { name: `${doctor.firstName} ${doctor.lastName}` }))
    } catch {
      // Error is handled by store
    }
  }

  const handleFormSubmit = useCallback(
    async (data: CreateDoctorData) => {
      try {
        if (selectedDoctor) {
          await editDoctor(selectedDoctor.id, data)
          setSuccessMessage(t('doctors.toast.updated', { name: `${data.firstName} ${data.lastName}` }))
        } else {
          await addDoctor(data)
          setSuccessMessage(t('doctors.toast.created', { name: `${data.firstName} ${data.lastName}` }))
        }
        setIsFormOpen(false)
        setSelectedDoctor(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedDoctor, addDoctor, editDoctor, t]
  )

  const handleConfirmDelete = async () => {
    if (!doctorToDelete) return
    setIsDeleting(true)
    try {
      await removeDoctor(doctorToDelete.id)
      setSuccessMessage(
        t('doctors.toast.deleted', { name: `${doctorToDelete.firstName} ${doctorToDelete.lastName}` })
      )
      setDoctorToDelete(null)
    } catch {
      // Error is handled by store
    } finally {
      setIsDeleting(false)
    }
  }

  const canAddDoctor = stats ? stats.remaining > 0 : true
  const limitReached = stats && stats.remaining <= 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('doctors.title')}</h1>
          <p className="text-gray-600 mt-1">
            {t('doctors.subtitle')}
            {stats && (
              <span className="text-gray-500 ml-1">
                {t('doctors.availableCount', { active: stats.active, limit: stats.limit })}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          disabled={!canAddDoctor}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="h-5 w-5" />
          {t('doctors.newDoctor')}
        </button>
      </div>

      {/* Limit reached banner */}
      {limitReached && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-800">{t('doctors.limitBanner.title')}</h3>
            <p className="text-sm text-amber-700 mt-1">
              {t('doctors.limitBanner.body', { limit: stats?.limit })}
            </p>
            <span className="mt-2 inline-block text-sm font-medium text-amber-800 hover:text-amber-900 underline cursor-pointer">
              {t('doctors.limitBanner.viewPlans')}
            </span>
          </div>
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
          <div className="flex-1">
            <p className="text-red-800">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-red-500 hover:text-red-700 p-1"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder={t('doctors.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          {t('doctors.showInactiveFilter')}
        </label>
      </div>

      {/* Loading state */}
      {isLoading && doctors.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && doctors.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <Stethoscope className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">
            {searchQuery ? t('doctors.emptyState.noResults') : t('doctors.emptyState.noDoctors')}
          </h3>
          <p className="text-gray-600 mt-1">
            {searchQuery
              ? t('doctors.emptyState.noResultsHint')
              : t('doctors.emptyState.noDoctorsHint')}
          </p>
          {!searchQuery && canAddDoctor && (
            <button
              onClick={handleOpenCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              {t('doctors.addDoctor')}
            </button>
          )}
        </div>
      )}

      {/* Doctors list */}
      {doctors.length > 0 && (
        <DoctorsListView
          doctors={doctors}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRestore={handleRestore}
        />
      )}

      {/* Form Modal */}
      <DoctorFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setSelectedDoctor(null)
        }}
        onSubmit={handleFormSubmit}
        doctor={selectedDoctor}
        isLoading={isLoading}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!doctorToDelete}
        onClose={() => setDoctorToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('doctors.deleteDoctor')}
        message={t('doctors.deleteConfirmMessage', {
          name: `${doctorToDelete?.firstName} ${doctorToDelete?.lastName}`,
        })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}

export default DoctorsPage
