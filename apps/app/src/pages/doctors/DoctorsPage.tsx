import { useEffect, useState, useCallback } from 'react'
import { Plus, Search, AlertCircle, Stethoscope, Loader2, X } from 'lucide-react'
import { useDoctorsStore } from '@/stores/doctors.store'
import { DoctorsListView } from '@/components/doctors/DoctorsListView'
import { DoctorFormModal } from '@/components/doctors/DoctorFormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Doctor, CreateDoctorData } from '@/lib/doctor-api'

export function DoctorsPage() {
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
      setSuccessMessage(`Dr. ${doctor.firstName} ${doctor.lastName} ha sido restaurado`)
    } catch {
      // Error is handled by store
    }
  }

  const handleFormSubmit = useCallback(
    async (data: CreateDoctorData) => {
      try {
        if (selectedDoctor) {
          await editDoctor(selectedDoctor.id, data)
          setSuccessMessage(`Dr. ${data.firstName} ${data.lastName} actualizado exitosamente`)
        } else {
          await addDoctor(data)
          setSuccessMessage(`Dr. ${data.firstName} ${data.lastName} creado exitosamente`)
        }
        setIsFormOpen(false)
        setSelectedDoctor(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedDoctor, addDoctor, editDoctor]
  )

  const handleConfirmDelete = async () => {
    if (!doctorToDelete) return
    setIsDeleting(true)
    try {
      await removeDoctor(doctorToDelete.id)
      setSuccessMessage(`Dr. ${doctorToDelete.firstName} ${doctorToDelete.lastName} eliminado`)
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
          <h1 className="text-2xl font-bold text-gray-900">Doctores</h1>
          <p className="text-gray-600 mt-1">
            Gestiona los doctores de tu clínica
            {stats && (
              <span className="text-gray-500 ml-1">
                ({stats.active} de {stats.limit} disponibles)
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
          Nuevo Doctor
        </button>
      </div>

      {/* Limit reached banner */}
      {limitReached && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-800">Límite de doctores alcanzado</h3>
            <p className="text-sm text-amber-700 mt-1">
              Tu plan actual permite hasta {stats?.limit} doctores. Para agregar más doctores,
              actualiza tu plan a uno superior.
            </p>
            <span className="mt-2 inline-block text-sm font-medium text-amber-800 hover:text-amber-900 underline cursor-pointer">
              Ver planes disponibles
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
            aria-label="Cerrar"
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
            placeholder="Buscar por nombre, email o especialidad..."
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
          Mostrar inactivos
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
            {searchQuery ? 'No se encontraron doctores' : 'No hay doctores'}
          </h3>
          <p className="text-gray-600 mt-1">
            {searchQuery
              ? 'Intenta con otros términos de búsqueda'
              : 'Comienza agregando tu primer doctor'}
          </p>
          {!searchQuery && canAddDoctor && (
            <button
              onClick={handleOpenCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              Agregar Doctor
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
        title="Eliminar Doctor"
        message={`¿Estás seguro de que deseas eliminar a Dr. ${doctorToDelete?.firstName} ${doctorToDelete?.lastName}? Esta acción se puede revertir restaurando el doctor posteriormente.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}

export default DoctorsPage
