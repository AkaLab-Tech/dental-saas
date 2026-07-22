import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, CheckCircle2, AlertCircle, FileJson, Database } from 'lucide-react'
import { exportData } from '@/lib/export-api'

export function DataExportForm() {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    setSuccess(false)

    try {
      await exportData()
      setSuccess(true)
      // Auto-clear success after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.exportError'))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
          <Database className="h-5 w-5" />
          Exportar Datos
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Descarga todos los datos de tu clínica en formato JSON
        </p>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-800 mb-2">
          ¿Qué incluye la exportación?
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Información de la clínica
          </li>
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Todos los pacientes y su historial dental
          </li>
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Doctores y sus datos
          </li>
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Historial de citas
          </li>
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Trabajos de laboratorio
          </li>
          <li className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Registro de gastos
          </li>
        </ul>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Success Alert */}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">
            ¡Datos exportados exitosamente! Revisa tu carpeta de descargas.
          </p>
        </div>
      )}

      {/* Export Button */}
      <div className="pt-4 border-t border-gray-200">
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isExporting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Exportando...
            </>
          ) : (
            <>
              <Download className="h-5 w-5" />
              Descargar Datos
            </>
          )}
        </button>
        <p className="mt-2 text-xs text-gray-500">
          El archivo se descargará en formato JSON
        </p>
      </div>
    </div>
  )
}
