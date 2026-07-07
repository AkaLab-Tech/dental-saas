import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { Plus, Search, AlertCircle, Users, Loader2, X } from 'lucide-react'
import { usePatientsStore } from '@/stores/patients.store'
import { PatientCard } from '@/components/patients/PatientCard'
import { PatientFormModal } from '@/components/patients/PatientFormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
// SPIKE #213: throwaway list-view alternatives, gated behind ?view=. See docs/spikes/213-patient-doctor-list-views.md
import { PatientsTableView } from './spike/PatientsTableView'
import { PatientsHybridView } from './spike/PatientsHybridView'
import type { Patient, CreatePatientData } from '@/lib/patient-api'

export function PatientsPage() {
  // SPIKE #213: ?view=table|hybrid|cards toggles the POC renderers below.
  // Default (no param, or ?view=cards) is unchanged production behavior.
  const [searchParams] = useSearchParams()
  const spikeView = searchParams.get('view')

  const {
    patients,
    stats,
    isLoading,
    error,
    searchQuery,
    showInactive,
    fetchPatients,
    fetchStats,
    addPatient,
    editPatient,
    removePatient,
    restoreDeletedPatient,
    setSearchQuery,
    setShowInactive,
    clearError,
  } = usePatientsStore()

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Fetch patients on mount
  useEffect(() => {
    fetchPatients()
    fetchStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPatients()
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
    setSelectedPatient(null)
    setIsFormOpen(true)
  }

  const handleEdit = (patient: Patient) => {
    setSelectedPatient(patient)
    setIsFormOpen(true)
  }

  const handleDelete = (patient: Patient) => {
    setPatientToDelete(patient)
  }

  const handleRestore = async (patient: Patient) => {
    try {
      await restoreDeletedPatient(patient.id)
      setSuccessMessage(`${patient.firstName} ${patient.lastName} ha sido restaurado`)
    } catch {
      // Error is handled by store
    }
  }

  const handleFormSubmit = useCallback(
    async (data: CreatePatientData) => {
      try {
        if (selectedPatient) {
          await editPatient(selectedPatient.id, data)
          setSuccessMessage(`${data.firstName} ${data.lastName} actualizado exitosamente`)
        } else {
          await addPatient(data)
          setSuccessMessage(`${data.firstName} ${data.lastName} creado exitosamente`)
        }
        setIsFormOpen(false)
        setSelectedPatient(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedPatient, addPatient, editPatient]
  )

  const handleConfirmDelete = async () => {
    if (!patientToDelete) return
    setIsDeleting(true)
    try {
      await removePatient(patientToDelete.id)
      setSuccessMessage(`${patientToDelete.firstName} ${patientToDelete.lastName} eliminado`)
      setPatientToDelete(null)
    } catch {
      // Error is handled by store
    } finally {
      setIsDeleting(false)
    }
  }

  const canAddPatient = stats ? stats.remaining > 0 : true
  const limitReached = stats && stats.remaining <= 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pacientes</h1>
          <p className="text-gray-600 mt-1">
            Gestiona los pacientes de tu clínica
            {stats && (
              <span className="text-gray-500 ml-1">
                ({stats.active} de {stats.limit} disponibles)
              </span>
            )}
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          disabled={!canAddPatient}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="h-5 w-5" />
          Nuevo Paciente
        </button>
      </div>

      {/* Limit reached banner */}
      {limitReached && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-800">Límite de pacientes alcanzado</h3>
            <p className="text-sm text-amber-700 mt-1">
              Tu plan actual permite hasta {stats?.limit} pacientes. Para agregar más pacientes,
              actualiza tu plan a uno superior.
            </p>
            <span className="mt-2 inline-block text-sm font-medium text-amber-800">
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
            placeholder="Buscar por nombre, email o teléfono..."
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
      {isLoading && patients.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && patients.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <Users className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">
            {searchQuery ? 'No se encontraron pacientes' : 'No hay pacientes'}
          </h3>
          <p className="text-gray-600 mt-1">
            {searchQuery
              ? 'Intenta con otros términos de búsqueda'
              : 'Comienza agregando tu primer paciente'}
          </p>
          {!searchQuery && canAddPatient && (
            <button
              onClick={handleOpenCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              Agregar Paciente
            </button>
          )}
        </div>
      )}

      {/* Patients grid (default) / SPIKE #213 view alternatives */}
      {patients.length > 0 && (
        spikeView === 'table' ? (
          <PatientsTableView
            patients={patients}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRestore={handleRestore}
          />
        ) : spikeView === 'hybrid' ? (
          <PatientsHybridView
            patients={patients}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRestore={handleRestore}
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((patient) => (
              <PatientCard
                key={patient.id}
                patient={patient}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            ))}
          </div>
        )
      )}

      {/* Form Modal */}
      <PatientFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setSelectedPatient(null)
        }}
        onSubmit={handleFormSubmit}
        patient={selectedPatient}
        isLoading={isLoading}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar Paciente"
        message={`¿Estás seguro de que deseas eliminar a ${patientToDelete?.firstName} ${patientToDelete?.lastName}? Esta acción se puede revertir restaurando el paciente posteriormente.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}

export default PatientsPage
