import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Search,
  AlertCircle,
  FlaskConical,
  Loader2,
  X,
  Filter,
  DollarSign,
  Package,
} from 'lucide-react'
import { Permission } from '@dental/shared'
import { useLabworksStore } from '@/stores/labworks.store'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/format'
import { LabworkCard } from '@/components/labworks/LabworkCard'
import { LabworkFormModal } from '@/components/labworks/LabworkFormModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Can } from '@/components/auth'
import type { Labwork, CreateLabworkData, UpdateLabworkData } from '@/lib/labwork-api'

export function LabworksPage() {
  const {
    labworks,
    stats,
    total,
    loading,
    error,
    filters,
    fetchLabworks,
    fetchStats,
    createLabwork,
    updateLabwork,
    deleteLabwork,
    restoreLabwork,
    setFilters,
    clearError,
  } = useLabworksStore()

  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedLabwork, setSelectedLabwork] = useState<Labwork | null>(null)
  const [labworkToDelete, setLabworkToDelete] = useState<Labwork | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch labworks on mount
  useEffect(() => {
    fetchLabworks()
    fetchStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLabworks({ search: searchQuery || undefined })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Re-fetch when filters change
  useEffect(() => {
    fetchLabworks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleOpenCreate = () => {
    setSelectedLabwork(null)
    setIsFormOpen(true)
  }

  const handleEdit = (labwork: Labwork) => {
    setSelectedLabwork(labwork)
    setIsFormOpen(true)
  }

  const handleDelete = (labwork: Labwork) => {
    setLabworkToDelete(labwork)
  }

  const handleRestore = async (labwork: Labwork) => {
    try {
      await restoreLabwork(labwork.id)
      setSuccessMessage(`Trabajo de laboratorio restaurado`)
    } catch {
      // Error is handled by store
    }
  }

  const handleTogglePaid = async (labwork: Labwork) => {
    try {
      await updateLabwork(labwork.id, { isPaid: !labwork.isPaid })
    } catch {
      // Error is handled by store
    }
  }

  const handleToggleDelivered = async (labwork: Labwork) => {
    try {
      await updateLabwork(labwork.id, { isDelivered: !labwork.isDelivered })
    } catch {
      // Error is handled by store
    }
  }

  const handleFormSubmit = useCallback(
    async (data: CreateLabworkData) => {
      try {
        if (selectedLabwork) {
          await updateLabwork(selectedLabwork.id, data as UpdateLabworkData)
          setSuccessMessage(`Trabajo de laboratorio actualizado exitosamente`)
        } else {
          await createLabwork(data)
          setSuccessMessage(`Trabajo de laboratorio creado exitosamente`)
        }
        setIsFormOpen(false)
        setSelectedLabwork(null)
      } catch {
        // Error is handled by store
      }
    },
    [selectedLabwork, createLabwork, updateLabwork]
  )

  const handleConfirmDelete = async () => {
    if (!labworkToDelete) return
    setIsDeleting(true)
    try {
      await deleteLabwork(labworkToDelete.id)
      setSuccessMessage(`Trabajo de laboratorio eliminado`)
      setLabworkToDelete(null)
    } catch {
      // Error is handled by store
    } finally {
      setIsDeleting(false)
    }
  }

  const handleFilterChange = (key: 'isPaid' | 'isDelivered', value: boolean | undefined) => {
    setFilters({ [key]: value })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trabajos de Laboratorio</h1>
          <p className="text-gray-600 mt-1">
            Gestiona los trabajos enviados a laboratorio
            {stats && (
              <span className="text-gray-500 ml-1">
                ({stats.total} trabajos, {formatCurrency(stats.totalValue || 0, currency)})
              </span>
            )}
          </p>
        </div>

        <Can permission={Permission.LABWORKS_CREATE}>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            Nuevo Trabajo
          </button>
        </Can>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <FlaskConical className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-xl font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Por Pagar</p>
                <p className="text-xl font-semibold text-gray-900">{stats.unpaid}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Por Entregar</p>
                <p className="text-xl font-semibold text-gray-900">{stats.pending}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Valor Total</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatCurrency(stats.totalValue || 0, currency)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por laboratorio o paciente..."
            className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 border rounded-lg transition-colors ${showFilters || filters.isPaid !== undefined || filters.isDelivered !== undefined
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
        >
          <Filter className="h-5 w-5" />
          Filtros
        </button>
      </div>

      {/* Filter options */}
      {showFilters && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Estado de Pago</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleFilterChange('isPaid', undefined)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === undefined
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Todos
              </button>
              <button
                onClick={() => handleFilterChange('isPaid', true)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === true
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Pagados
              </button>
              <button
                onClick={() => handleFilterChange('isPaid', false)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isPaid === false
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Pendientes
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Estado de Entrega</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleFilterChange('isDelivered', undefined)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isDelivered === undefined
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Todos
              </button>
              <button
                onClick={() => handleFilterChange('isDelivered', true)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isDelivered === true
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Entregados
              </button>
              <button
                onClick={() => handleFilterChange('isDelivered', false)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filters.isDelivered === false
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                Por Entregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-green-600" />
          <p className="text-green-800">{successMessage}</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-800">{error}</p>
            <button onClick={clearError} className="text-sm text-red-600 hover:underline mt-1">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && labworks.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && labworks.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <FlaskConical className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No hay trabajos de laboratorio</h3>
          <p className="text-gray-600 mb-4">
            {searchQuery || filters.isPaid !== undefined || filters.isDelivered !== undefined
              ? 'No se encontraron trabajos con los filtros aplicados'
              : 'Comienza creando tu primer trabajo de laboratorio'}
          </p>
          {!searchQuery && filters.isPaid === undefined && filters.isDelivered === undefined && (
            <Can permission={Permission.LABWORKS_CREATE}>
              <button
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                Crear Trabajo
              </button>
            </Can>
          )}
        </div>
      )}

      {/* Labworks grid */}
      {labworks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {labworks.map((labwork) => (
            <LabworkCard
              key={labwork.id}
              labwork={labwork}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onTogglePaid={handleTogglePaid}
              onToggleDelivered={handleToggleDelivered}
            />
          ))}
        </div>
      )}

      {/* Pagination info */}
      {total > labworks.length && (
        <div className="text-center text-sm text-gray-500">
          Mostrando {labworks.length} de {total} trabajos
        </div>
      )}

      {/* Form Modal */}
      <LabworkFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setSelectedLabwork(null)
        }}
        onSubmit={handleFormSubmit}
        labwork={selectedLabwork}
        isLoading={loading}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!labworkToDelete}
        onClose={() => setLabworkToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar Trabajo de Laboratorio"
        message={`¿Estás seguro de que deseas eliminar el trabajo de "${labworkToDelete?.lab}"? Esta acción puede deshacerse.`}
        confirmText="Eliminar"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}
