import { useEffect, useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import type { Patient, CreatePatientData } from '@/lib/patient-api'
import { getConvenioNames } from '@/lib/patient-api'

// ============================================================================
// Validation Schema
// ============================================================================

const patientFormSchema = z.object({
  firstName: z.string().min(1, 'El nombre es requerido'),
  lastName: z.string().min(1, 'El apellido es requerido'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  dob: z
    .string()
    .optional()
    .refine(
      (value) => {
        if (!value) return true
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return false
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        date.setHours(0, 0, 0, 0)
        return date <= today
      },
      { message: 'La fecha de nacimiento no puede ser en el futuro' }
    ),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().or(z.literal('')),
  coverageType: z.enum(['PARTICULAR', 'CONVENIO']).optional().or(z.literal('')),
  convenioName: z.string().max(120, 'El nombre del convenio no puede exceder 120 caracteres').optional(),
  address: z.string().max(500, 'La dirección no puede exceder 500 caracteres').optional(),
})

type PatientFormData = z.infer<typeof patientFormSchema>

// ============================================================================
// Constants
// ============================================================================

const GENDER_OPTIONS = [
  { value: '', label: 'Seleccionar...' },
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Femenino' },
  { value: 'other', label: 'Otro' },
  { value: 'prefer_not_to_say', label: 'Prefiere no decir' },
] as const

const COVERAGE_TYPE_OPTIONS = [
  { value: 'PARTICULAR', label: 'Particular' },
  { value: 'CONVENIO', label: 'Convenio' },
] as const

// ============================================================================
// Component
// ============================================================================

interface PatientFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreatePatientData) => Promise<void>
  patient?: Patient | null
  isLoading?: boolean
}

export function PatientFormModal({
  isOpen,
  onClose,
  onSubmit,
  patient,
  isLoading = false,
}: PatientFormModalProps) {
  const isEditing = !!patient
  const [convenioNames, setConvenioNames] = useState<string[]>([])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dob: '',
      gender: '',
      coverageType: 'PARTICULAR',
      convenioName: '',
      address: '',
    },
  })

  const coverageType = watch('coverageType')

  // Reset form when patient changes or modal opens
  useEffect(() => {
    if (isOpen) {
      if (patient) {
        reset({
          firstName: patient.firstName,
          lastName: patient.lastName,
          email: patient.email || '',
          phone: patient.phone || '',
          dob: patient.dob ? patient.dob.split('T')[0] : '',
          gender: patient.gender || '',
          coverageType: patient.coverageType || 'PARTICULAR',
          convenioName: patient.convenioName || '',
          address: patient.address || '',
        })
      } else {
        reset({
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          dob: '',
          gender: '',
          coverageType: 'PARTICULAR',
          convenioName: '',
          address: '',
        })
      }
    }
  }, [isOpen, patient, reset])

  // Fetch previously used convenio names for autocomplete when the modal opens
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getConvenioNames()
      .then((names) => {
        if (!cancelled) setConvenioNames(names)
      })
      .catch(() => {
        if (!cancelled) setConvenioNames([])
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const handleFormSubmit = async (data: PatientFormData) => {
    const submitData: CreatePatientData = {
      firstName: data.firstName,
      lastName: data.lastName,
      ...(data.email && { email: data.email }),
      ...(data.phone && { phone: data.phone }),
      ...(data.dob && { dob: data.dob }),
      ...(data.gender && { gender: data.gender as CreatePatientData['gender'] }),
      coverageType: (data.coverageType || 'PARTICULAR') as CreatePatientData['coverageType'],
      ...(data.coverageType === 'CONVENIO'
        ? { convenioName: data.convenioName?.trim() || null }
        : { convenioName: null }),
      ...(data.address && { address: data.address }),
    }

    await onSubmit(submitData)
  }

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isLoading) {
        onClose()
      }
    },
    [onClose, isSubmitting, isLoading]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const modalTitleId = 'patient-form-modal-title'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 id={modalTitleId} className="text-xl font-semibold text-gray-900">
              {isEditing ? 'Editar Paciente' : 'Nuevo Paciente'}
            </h2>
            <button
              onClick={onClose}
              aria-label="Cerrar formulario"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form noValidate onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="px-6 py-4 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
              {/* Basic info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre *
                  </label>
                  <input
                    type="text"
                    {...register('firstName')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Juan"
                  />
                  {errors.firstName && (
                    <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Apellido *
                  </label>
                  <input
                    type="text"
                    {...register('lastName')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Pérez"
                  />
                  {errors.lastName && (
                    <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    {...register('email')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="paciente@email.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    {...register('phone')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="+1 234 567 890"
                  />
                </div>
              </div>

              {/* Personal info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de Nacimiento
                  </label>
                  <input
                    type="date"
                    {...register('dob')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Género
                  </label>
                  <select
                    {...register('gender')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {GENDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Coverage type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Cobertura
                  </label>
                  <select
                    {...register('coverageType')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {COVERAGE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {coverageType === 'CONVENIO' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre del Convenio
                    </label>
                    <input
                      type="text"
                      list="convenio-suggestions"
                      autoComplete="off"
                      {...register('convenioName')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Nombre del convenio"
                    />
                    <datalist id="convenio-suggestions">
                      {convenioNames.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    {errors.convenioName && (
                      <p className="mt-1 text-sm text-red-600">{errors.convenioName.message}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Address */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dirección
                </label>
                <textarea
                  {...register('address')}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Calle, número, ciudad, código postal..."
                />
                {errors.address && (
                  <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 rounded-b-xl border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {(isSubmitting || isLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEditing ? 'Guardar Cambios' : 'Crear Paciente'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default PatientFormModal
