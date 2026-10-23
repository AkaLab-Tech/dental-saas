import { useEffect, useId, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isBudgetAssociable } from '@dental/shared'
import { useTranslation } from 'react-i18next'
import { X, Loader2, Calendar, Clock, User, Stethoscope, AlertCircle, ClipboardList } from 'lucide-react'
import type {
  Appointment,
  CreateAppointmentData,
  UpdateAppointmentData,
  AppointmentStatus,
  AppointmentBudgetItemSummary,
} from '../../lib/appointment-api'
import { getStatusLabel, getAppointmentBudgetItems, getAppointmentById } from '../../lib/appointment-api'
import * as patientApi from '../../lib/patient-api'
import * as doctorApi from '../../lib/doctor-api'
import { listBudgetsByPatient, createBudget, type BudgetItemStatus, type CreateBudgetData } from '../../lib/budget-api'
import { BudgetFormModal } from '../budgets/BudgetFormModal'
import { formatDateForInput, formatCurrency } from '../../lib/format'
import { PatientSearchCombobox, type PatientOption } from '../ui/PatientSearchCombobox'
import { DatePicker } from '../ui/DatePicker'
import { TimePicker } from '../ui/TimePicker'
import { DoctorPicker, type DoctorOption } from '../ui/DoctorPicker'
import { useAuthStore } from '../../stores/auth.store'
import { useSettingsStore } from '../../stores/settings.store'

interface EligibleBudgetItem {
  id: string
  budgetId: string
  description: string
  toothNumber: string | null
  status: BudgetItemStatus
  unitPrice: string
  totalPrice: string
  quantity: number
}

const BUDGET_ITEM_STATUS_STYLES: Record<BudgetItemStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700 border-gray-200',
  SCHEDULED: 'bg-blue-100 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 border-blue-200',
  EXECUTED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
}

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]

// Input schema (before transform)
const appointmentFormSchemaInput = z.object({
  patientId: z.string().min(1, 'El paciente es requerido'),
  doctorId: z.string().min(1, 'El doctor es requerido'),
  date: z.string().min(1, 'La fecha es requerida'),
  startTime: z.string().min(1, 'La hora de inicio es requerida'),
  endTime: z.string().min(1, 'La hora de fin es requerida'),
  type: z.string().optional(),
  notes: z.string().optional(),
  cost: z.string().optional(),
  paidAmount: z.string().optional(),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']).optional(),
}).refine((data) => {
  if (data.startTime && data.endTime) {
    return data.startTime < data.endTime
  }
  return true
}, {
  message: 'La hora de fin debe ser posterior a la hora de inicio',
  path: ['endTime'],
})

type FormData = z.input<typeof appointmentFormSchemaInput>

interface AppointmentFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateAppointmentData | UpdateAppointmentData) => Promise<void>
  appointment?: Appointment | null
  isLoading?: boolean
  defaultDate?: Date
  defaultPatientId?: string
  error?: string | null
}

export function AppointmentFormModal({
  isOpen,
  onClose,
  onSubmit,
  appointment,
  isLoading = false,
  defaultDate,
  defaultPatientId,
  error: externalError,
}: AppointmentFormModalProps) {
  const { t } = useTranslation()
  const modalTitleId = useId()
  const isEditing = !!appointment
  // isPaid is FIFO-owned: after a reversal the patient's advances can re-cover
  // the item, so it can be true with no consultation payment left to reverse.
  // It says the item is covered, not that anything was charged here (#523).
  const isAlreadyPaid = isEditing && !!appointment?.isPaid
  // Keyed off the server's linked-payment check, not the FIFO-allocated
  // paidAmount (which can read 0 despite a payment being recorded — #373).
  const hasRecordedPaidAmount = isEditing && !!appointment?.hasRecordedPayment
  const paidAmountLocked = hasRecordedPaidAmount
  const currency = useAuthStore((s) => s.user?.tenant?.currency) || 'USD'
  // The executed-items figure is only on appointments read through get-by-id or
  // get-by-patient; the calendar and the doctor record feed the modal without
  // it. Absence on the prop therefore cannot tell "none executed" from "never
  // loaded", so when it is missing the modal asks the server itself (#544).
  const appointmentId = appointment?.id
  const propExecuted = appointment?.budgetItems
  const [fetchedExecuted, setFetchedExecuted] = useState<{
    id: string
    failed: boolean
    summary?: NonNullable<Appointment['budgetItems']>
  } | null>(null)
  useEffect(() => {
    if (!isOpen || !appointmentId || propExecuted) return
    let cancelled = false
    // Drop any previous outcome before asking again. Without this a failure
    // sticks for the life of the component: `isOpen` false -> true re-runs this
    // effect, but `if (!isOpen) return null` is a render guard and not an
    // unmount, so the old `failed: true` survived and the reopened modal showed
    // the warning instantly without ever retrying. Clearing it also restores the
    // in-flight state, which is what makes the retry visible.
    setFetchedExecuted(null)
    getAppointmentById(appointmentId)
      .then((full) => {
        if (!cancelled) setFetchedExecuted({ id: appointmentId, failed: false, summary: full.budgetItems })
      })
      .catch(() => {
        if (!cancelled) setFetchedExecuted({ id: appointmentId, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, appointmentId, propExecuted])
  const executedFetch = fetchedExecuted?.id === appointmentId ? fetchedExecuted : null
  const executedSummary = propExecuted ?? executedFetch?.summary
  const executedLoading = isEditing && !propExecuted && !executedFetch
  const executedUnavailable = isEditing && !propExecuted && !!executedFetch?.failed
  const typeListId = useId()
  const doctorFieldId = useId()

  // Settings drive the per-type end-time auto-fill below. Loaded lazily since
  // SettingsPage is the only other caller of fetchSettings — if loading
  // fails, the effect below simply falls back to today's manual behaviour.
  // A single attempt per modal-open avoids retry-looping on failure: the
  // store flips isLoading back to false on error, which would otherwise look
  // identical to "never tried" and re-trigger the fetch forever.
  const settings = useSettingsStore((s) => s.settings)
  const fetchSettings = useSettingsStore((s) => s.fetchSettings)
  const settingsFetchAttemptedRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      settingsFetchAttemptedRef.current = false
      return
    }
    if (!settings && !settingsFetchAttemptedRef.current) {
      settingsFetchAttemptedRef.current = true
      fetchSettings()
    }
  }, [isOpen, settings, fetchSettings])

  // State for doctor options
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  // Selected patient state for the combobox
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)

  // Budget items eligible for association (patient's non-CANCELLED budgets,
  // items in PENDING/SCHEDULED) and the current checkbox selection.
  const [budgetItems, setBudgetItems] = useState<EligibleBudgetItem[]>([])
  const [selectedBudgetItemIds, setSelectedBudgetItemIds] = useState<string[]>([])
  const [loadingBudgetItems, setLoadingBudgetItems] = useState(false)
  // True when the patient has draft budgets with lines that would otherwise
  // be offered; drives the on-screen reason they are missing.
  const [hasHiddenDraftItems, setHasHiddenDraftItems] = useState(false)
  // Tracks the last patientId a fetch ran for, so a same-patient re-render
  // (e.g. options finishing load) doesn't wipe out the user's selection.
  const lastBudgetPatientIdRef = useRef<string | null>(null)
  // Nested budget creation. It renders over this form instead of navigating
  // away, so everything typed here stays mounted; bumping the reload key
  // re-runs the budget-items effect (same patient, so the selection is kept).
  const [isBudgetFormOpen, setIsBudgetFormOpen] = useState(false)
  const [budgetFormError, setBudgetFormError] = useState<string | null>(null)
  const [isCreatingBudget, setIsCreatingBudget] = useState(false)
  const [budgetsReloadKey, setBudgetsReloadKey] = useState(0)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    control,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormData>({
    resolver: zodResolver(appointmentFormSchemaInput),
    defaultValues: {
      patientId: '',
      doctorId: '',
      date: '',
      startTime: '',
      endTime: '',
      type: '',
      notes: '',
      cost: '',
      paidAmount: '',
      status: 'SCHEDULED',
    },
  })

  const watchedPatientId = watch('patientId')
  const watchedType = watch('type')
  const watchedStartTime = watch('startTime')

  // Fetch doctors (and resolve patient name if needed) when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchOptions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const fetchOptions = async () => {
    setLoadingOptions(true)
    try {
      const doctorsRes = await doctorApi.getDoctors({ limit: 100 })
      setDoctors(doctorsRes as unknown as DoctorOption[])

      // Resolve patient name for defaultPatientId or editing
      if (defaultPatientId || appointment?.patientId) {
        const patientIdToResolve = defaultPatientId || appointment?.patientId
        const patientsRes = await patientApi.getPatients({ limit: 100 })
        const found = (patientsRes as unknown as PatientOption[]).find(p => p.id === patientIdToResolve)
        if (found) {
          setSelectedPatient(found)
        }
      }
    } catch (error) {
      console.error('Error fetching options:', error)
    } finally {
      setLoadingOptions(false)
    }
  }

  // Reset form once per modal-open for a given appointment identity. Must NOT
  // depend on loadingOptions: that flag flips true->false when getDoctors()
  // resolves, and re-running reset() on that transition would wipe out
  // whatever the user already typed/selected (patient, budget items) while
  // the doctors list was still loading.
  const resetIdentityRef = useRef<string | null>(null)
  // The last cost figure the items prefill proposed (see the effect below).
  const prefilledCostRef = useRef<string | null>(null)
  // Armed only by the operator ticking/unticking an item in this session. The
  // items of an appointment being edited load asynchronously AFTER the reset
  // below, so a total above zero on its own cannot tell "the operator just
  // associated items" from "this appointment already had items when it
  // opened" - and a reopen is neither of task #590's triggers (associating
  // items, or confirming them executed), so it must propose nothing.
  const costPrefillArmedRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      resetIdentityRef.current = null
      return
    }

    const identity = appointment?.id ?? 'new'
    if (resetIdentityRef.current === identity) return
    resetIdentityRef.current = identity
    // A reset discards whatever the cost prefill proposed for the previous
    // identity, so its memory of its own proposal has to go with it.
    prefilledCostRef.current = null
    costPrefillArmedRef.current = false

    if (appointment) {
      const startDate = new Date(appointment.startTime)
      const endDate = new Date(appointment.endTime)
      // Empty by default: editing/rescheduling an unpaid appointment must
      // submit nothing. A locked field is the one exception — it displays
      // the recorded amount read-only (register()'s `disabled` keeps it out
      // of the submit payload regardless).
      const lockedPaidAmount = paidAmountLocked ? appointment.recordedPaidAmount : undefined

      reset({
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        date: formatDateForInput(startDate),
        startTime: formatTimeForInput(startDate),
        endTime: formatTimeForInput(endDate),
        type: appointment.type || '',
        notes: appointment.notes || '',
        cost: appointment.cost?.toString() || '',
        paidAmount: lockedPaidAmount?.toString() || '',
        status: appointment.status,
      })
    } else {
      const dateToUse = defaultDate || new Date()
      reset({
        patientId: defaultPatientId || '',
        doctorId: '',
        date: formatDateForInput(dateToUse),
        startTime: '09:00',
        endTime: '09:30',
        type: '',
        notes: '',
        cost: '',
        paidAmount: '',
        status: 'SCHEDULED',
      })
    }
  }, [appointment, isOpen, defaultDate, defaultPatientId, reset, paidAmountLocked])

  // Suggest an end time from the entered type's configured duration (falling
  // back to the tenant default). In edit mode this only kicks in once the
  // user has actively edited the type themselves — never on the identity
  // reset() above — so opening an existing appointment never silently moves
  // its saved end time. The end time input stays editable either way.
  useEffect(() => {
    if (!isOpen) return
    if (isEditing && !dirtyFields.type) return
    if (!watchedStartTime) return

    const duration = resolveTypeDuration(
      watchedType || '',
      settings?.appointmentTypeDurations,
      settings?.defaultAppointmentDuration ?? 30
    )
    setValue('endTime', addMinutesToTime(watchedStartTime, duration), { shouldValidate: true })
  }, [isOpen, isEditing, dirtyFields.type, watchedType, watchedStartTime, settings, setValue])

  // Clear selected patient when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedPatient(null)
    }
  }, [isOpen])

  // Load the selected patient's eligible budget items whenever the patient
  // changes. On the first load for an appointment being edited, also hydrate
  // the pre-selection from the items currently SCHEDULED against it.
  useEffect(() => {
    if (!isOpen || !watchedPatientId) {
      setBudgetItems([])
      setSelectedBudgetItemIds([])
      lastBudgetPatientIdRef.current = null
      return
    }

    const isNewPatient = lastBudgetPatientIdRef.current !== watchedPatientId
    let cancelled = false
    setLoadingBudgetItems(true)

    const load = async () => {
      try {
        const [{ data: budgets }, associated] = await Promise.all([
          listBudgetsByPatient(watchedPatientId, { limit: 100 }),
          isEditing && appointment && appointment.patientId === watchedPatientId
            ? getAppointmentBudgetItems(appointment.id)
            : Promise.resolve<AppointmentBudgetItemSummary[]>([]),
        ])
        if (cancelled) return

        // An item is offered only when it is still PENDING (not committed
        // anywhere) or when it is already linked to THIS appointment — that
        // second branch is what keeps an appointment's own SCHEDULED/EXECUTED
        // items visible (and, for EXECUTED, checked+disabled below) instead of
        // vanishing once they stop being globally PENDING.
        const associatedIds = new Set(associated.map((item) => item.id))

        // Only budgets the patient accepted (APPROVED/PARTIAL) offer new
        // lines; a line already linked to this appointment stays visible
        // wherever it sits, so it can still be unchecked.
        setHasHiddenDraftItems(
          budgets.some(
            (budget) =>
              budget.status === 'DRAFT' &&
              budget.items.some((item) => item.status === 'PENDING' && !associatedIds.has(item.id))
          )
        )

        const eligible: EligibleBudgetItem[] = budgets
          .filter((budget) => budget.status !== 'CANCELLED')
          .flatMap((budget) =>
            budget.items
              .filter(
                (item) =>
                  associatedIds.has(item.id) ||
                  (item.status === 'PENDING' && isBudgetAssociable(budget.status))
              )
              .map((item) => ({
                id: item.id,
                budgetId: budget.id,
                description: item.description,
                toothNumber: item.toothNumber,
                status: item.status,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                quantity: item.quantity,
              }))
          )

        setBudgetItems(eligible)

        if (isNewPatient) {
          const preselected = associated
            .filter((item) => item.roles.includes('SCHEDULED'))
            .map((item) => item.id)
          setSelectedBudgetItemIds(preselected)
        }
      } catch (error) {
        console.error('Error fetching budget items:', error)
        if (!cancelled) {
          setBudgetItems([])
          setHasHiddenDraftItems(false)
          if (isNewPatient) setSelectedBudgetItemIds([])
        }
      } finally {
        if (!cancelled) setLoadingBudgetItems(false)
      }
    }

    load()
    lastBudgetPatientIdRef.current = watchedPatientId

    return () => {
      cancelled = true
    }
  }, [isOpen, watchedPatientId, isEditing, appointment, budgetsReloadKey])

  // The items this appointment is about to charge: the operator's current
  // selection plus the ones already confirmed executed here (shown
  // checked+disabled below). Totalled in cents so a 3-item selection cannot
  // land a sub-cent residue in the field.
  const itemsChargeTotal =
    budgetItems
      .filter((item) => item.status === 'EXECUTED' || selectedBudgetItemIds.includes(item.id))
      .reduce((cents, item) => cents + Math.round(Number(item.totalPrice) * 100), 0) / 100

  // Task #590: the appointment's cost is the single charge for the visit, so
  // associating items (or confirming them executed) PROPOSES their total in
  // the cost field instead of billing them on their own. Three properties this
  // effect must keep:
  //   - it is a prefill, not a write: nothing reaches the appointment row
  //     until the operator saves;
  //   - it only ever fills an empty field or replaces its own last proposal,
  //     so a figure the operator typed is never silently overwritten;
  //   - a total that falls to 0 (the last item unlinked) leaves the field as
  //     the operator last saw it — clearing a number someone typed is
  //     indistinguishable from losing it;
  //   - it needs an operator gesture (see costPrefillArmedRef): merely opening
  //     an appointment that already has items proposes nothing, so a
  //     historically costless visit cannot acquire a cost on an incidental
  //     save.
  useEffect(() => {
    if (!isOpen) {
      prefilledCostRef.current = null
      costPrefillArmedRef.current = false
      return
    }
    if (!costPrefillArmedRef.current) return
    if (itemsChargeTotal <= 0) return
    // Trailing zeros stripped: the number input shows "2500", not "2500.00".
    const proposal = String(Number(itemsChargeTotal.toFixed(2)))
    const current = getValues('cost')
    if (current !== '' && current !== prefilledCostRef.current) return
    prefilledCostRef.current = proposal
    setValue('cost', proposal, { shouldValidate: true })
  }, [isOpen, itemsChargeTotal, getValues, setValue])

  const toggleBudgetItem = (itemId: string) => {
    // The only gesture that arms the cost prefill. Set before the state update
    // so the effect keyed on the new total sees it on the very next render.
    costPrefillArmedRef.current = true
    setSelectedBudgetItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    )
  }

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // While the nested budget form is open, Escape belongs to it.
      if (e.key === 'Escape' && isOpen && !isBudgetFormOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, isBudgetFormOpen])

  const handleCreateBudget = async (data: CreateBudgetData) => {
    if (!watchedPatientId) return
    setIsCreatingBudget(true)
    setBudgetFormError(null)
    try {
      await createBudget(watchedPatientId, data)
      setIsBudgetFormOpen(false)
      setBudgetsReloadKey((key) => key + 1)
    } catch (e) {
      setBudgetFormError(e instanceof Error ? e.message : t('budgets.errors.createFailed'))
    } finally {
      setIsCreatingBudget(false)
    }
  }

  if (!isOpen) return null

  const handleFormSubmit = async (data: FormData) => {
    // Combine date and time into ISO strings
    const startDateTime = new Date(`${data.date}T${data.startTime}:00`)
    const endDateTime = new Date(`${data.date}T${data.endTime}:00`)

    const appointmentData: CreateAppointmentData | UpdateAppointmentData = {
      patientId: data.patientId,
      doctorId: data.doctorId,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      type: data.type || undefined,
      notes: data.notes || undefined,
      // Editing: an emptied field sends null so the API clears the stored cost;
      // "0" is a truthy string and still sends the number 0.
      cost: data.cost ? parseFloat(data.cost) : isEditing ? null : undefined,
      // No default value + register()'s `disabled` excluding locked fields
      // from RHF's data means only an operator-typed amount is ever sent.
      paidAmount: data.paidAmount ? parseFloat(data.paidAmount) : undefined,
      status: data.status || undefined,
      // Edit always sends the current selection as the replace-set (an empty
      // array unassociates everything); create only sends it when non-empty.
      budgetItemIds: isEditing
        ? selectedBudgetItemIds
        : selectedBudgetItemIds.length > 0
          ? selectedBudgetItemIds
          : undefined,
    }

    await onSubmit(appointmentData)
  }

  const handlePatientSelect = (patient: PatientOption) => {
    setSelectedPatient(patient)
    setValue('patientId', patient.id, { shouldValidate: true })
  }

  const handlePatientClear = () => {
    setSelectedPatient(null)
    setValue('patientId', '', { shouldValidate: true })
  }

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
            <h2 id={modalTitleId} className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              {isEditing ? t('appointments.editAppointment') : t('appointments.newAppointment')}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('appointments.form.closeForm')}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Error */}
          {externalError && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{externalError}</p>
            </div>
          )}

          {/* Form */}
          <form noValidate onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="px-6 py-4 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
              {/* Patient and Doctor */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <User className="h-4 w-4" />
                    {t('appointments.form.patient')} *
                  </label>
                  <PatientSearchCombobox
                    selectedPatient={selectedPatient}
                    onSelect={handlePatientSelect}
                    onClear={handlePatientClear}
                    disabled={!!defaultPatientId}
                    error={errors.patientId?.message}
                  />
                  <input type="hidden" {...register('patientId')} />
                </div>

                <div>
                  <label htmlFor={doctorFieldId} className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <Stethoscope className="h-4 w-4" />
                    {t('appointments.form.doctor')} *
                  </label>
                  <Controller
                    name="doctorId"
                    control={control}
                    render={({ field }) => (
                      <DoctorPicker
                        id={doctorFieldId}
                        doctors={doctors}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        fallback={appointment?.doctor}
                        loading={loadingOptions}
                        error={errors.doctorId?.message}
                      />
                    )}
                  />
                </div>
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="h-4 w-4" />
                    {t('appointments.form.date')} *
                  </label>
                  <Controller
                    name="date"
                    control={control}
                    render={({ field }) => (
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        error={!!errors.date}
                        aria-label={t('appointments.form.date')}
                      />
                    )}
                  />
                  {errors.date && (
                    <p className="mt-1 text-sm text-red-600">{errors.date.message}</p>
                  )}
                </div>

                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <Clock className="h-4 w-4" />
                    {t('appointments.form.startTime')} *
                  </label>
                  <Controller
                    name="startTime"
                    control={control}
                    render={({ field }) => (
                      <TimePicker
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        error={!!errors.startTime}
                        aria-label={t('appointments.form.startTime')}
                      />
                    )}
                  />
                  {errors.startTime && (
                    <p className="mt-1 text-sm text-red-600">{errors.startTime.message}</p>
                  )}
                </div>

                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <Clock className="h-4 w-4" />
                    {t('appointments.form.endTime')} *
                  </label>
                  <Controller
                    name="endTime"
                    control={control}
                    render={({ field }) => (
                      <TimePicker
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        error={!!errors.endTime}
                        aria-label={t('appointments.form.endTime')}
                      />
                    )}
                  />
                  {errors.endTime && (
                    <p className="mt-1 text-sm text-red-600">{errors.endTime.message}</p>
                  )}
                </div>
              </div>

              {/* Type and Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('appointments.form.type')}
                  </label>
                  <input
                    type="text"
                    {...register('type')}
                    list={typeListId}
                    placeholder={t('appointments.form.typePlaceholder')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <datalist id={typeListId}>
                    {settings?.appointmentTypeDurations?.map((entry) => (
                      <option key={entry.type} value={entry.type} />
                    ))}
                  </datalist>
                </div>

                {isEditing && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('appointments.statusLabel')}
                    </label>
                    <select
                      {...register('status')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {APPOINTMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {getStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Cost and Payment */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('appointments.form.cost')} ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('cost')}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {itemsChargeTotal > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('appointments.form.costFromItemsHint', {
                        total: formatCurrency(itemsChargeTotal, currency),
                      })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('appointments.form.paidAmount')} ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('paidAmount', { disabled: paidAmountLocked })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  {hasRecordedPaidAmount && isAlreadyPaid ? (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('appointments.form.alreadyPaidHint')}
                    </p>
                  ) : hasRecordedPaidAmount ? (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('appointments.form.partialPaymentRecordedHint')}
                    </p>
                  ) : isAlreadyPaid ? (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('appointments.form.coveredByBalanceHint')}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('appointments.form.paidAmountHint')}
                    </p>
                  )}
                </div>
              </div>

              {/* Task #590 removed the amber duplication warning that used to
                  fire here when a cost was typed beside executed items. A
                  double charge is no longer possible — the appointment's cost
                  supersedes the items' own charge — so warning about it would
                  be a false statement on screen, and a banner gets believed.
                  What is left is the quiet figure, with no alert role. */}
              {executedSummary && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                  <p className="text-gray-700">
                    {t('appointments.budgetItems.executedCharge', {
                      count: executedSummary.count,
                      total: formatCurrency(executedSummary.cost, currency),
                    })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('appointments.budgetItems.executedChargeStatus', {
                      paid: formatCurrency(executedSummary.paidAmount, currency),
                      outstanding: formatCurrency(executedSummary.outstanding, currency),
                    })}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('appointments.budgetItems.executedChargeHint')}
                  </p>
                </div>
              )}

              {executedLoading && (
                <p className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {/* Its own string: `budgetItems.loading` also labels the
                      selection list below, so the same sentence appeared twice
                      meaning two different things. */}
                  {t('appointments.budgetItems.executedChargeLoading')}
                </p>
              )}
              {/* The figure could not be loaded. It keeps role="alert" so a
                  screen reader hears it, but stays quiet: since #590 the cost
                  typed here is the charge either way, so not knowing the items'
                  total costs the operator information, not correctness. */}
              {executedUnavailable && (
                <p role="alert" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {t('appointments.budgetItems.executedChargeUnavailable')}
                </p>
              )}

              {/* Budget items */}
              {watchedPatientId && (
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    <ClipboardList className="h-4 w-4" />
                    {t('appointments.budgetItems.title')}
                  </label>
                  <p className="text-xs text-gray-500 mb-1">{t('appointments.budgetItems.selectHint')}</p>
                  <p className="text-xs text-gray-400 mb-2">{t('appointments.budgetItems.filterHint')}</p>
                  {hasHiddenDraftItems && (
                    <p className="text-xs text-amber-700 mb-2">{t('appointments.budgetItems.draftHint')}</p>
                  )}

                  {loadingBudgetItems ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('appointments.budgetItems.loading')}
                    </div>
                  ) : budgetItems.length === 0 ? (
                    <div className="py-1">
                      <p className="text-sm text-gray-500 italic">{t('appointments.budgetItems.empty')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setBudgetFormError(null)
                          setIsBudgetFormOpen(true)
                        }}
                        className="mt-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {t('appointments.budgetItems.createBudget')}
                      </button>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                      {budgetItems.map((item) => {
                        const isExecuted = item.status === 'EXECUTED'
                        return (
                          <label
                            key={item.id}
                            className={`flex items-start gap-2 px-3 py-2 ${
                              isExecuted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isExecuted || selectedBudgetItemIds.includes(item.id)}
                              disabled={isExecuted}
                              onChange={() => toggleBudgetItem(item.id)}
                              className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900">{item.description}</span>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BUDGET_ITEM_STATUS_STYLES[item.status]}`}
                                >
                                  {isExecuted ? t('appointments.complete.alreadyExecuted') : t(`budgets.itemStatus.${item.status}`)}
                                </span>
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {item.toothNumber && `${t('budgets.items.toothNumber')}: ${item.toothNumber} · `}
                                {formatCurrency(Number(item.totalPrice), currency)}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('appointments.form.notes')}
                </label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  placeholder={t('appointments.form.notesPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
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
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoading || loadingOptions}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {(isSubmitting || isLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEditing ? t('appointments.form.saveChanges') : t('appointments.form.createAppointment')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Sibling of the appointment <form> (forms cannot nest). Decision: the
          budget is created APPROVED, not DRAFT. The picker above only offers
          items of APPROVED/PARTIAL budgets (isBudgetAssociable), so a DRAFT
          created here would be invisible to the very picker that asked for it. */}
      <BudgetFormModal
        isOpen={isBudgetFormOpen}
        onClose={() => setIsBudgetFormOpen(false)}
        onSubmit={handleCreateBudget}
        isLoading={isCreatingBudget}
        error={budgetFormError}
        defaultStatus="APPROVED"
      />
    </div>
  )
}

// Helper functions
function formatTimeForInput(date: Date): string {
  return date.toTimeString().slice(0, 5)
}

// Matches the free-text `type` field against configured durations
// case-insensitively, ignoring surrounding whitespace.
function resolveTypeDuration(
  type: string,
  appointmentTypeDurations: { type: string; duration: number }[] | undefined,
  fallbackDuration: number
): number {
  const normalized = type.trim().toLowerCase()
  if (normalized) {
    const match = appointmentTypeDurations?.find(
      (entry) => entry.type.trim().toLowerCase() === normalized
    )
    if (match) return match.duration
  }
  return fallbackDuration
}

function addMinutesToTime(time: string, minutes: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return time
  const totalMinutes = (Number(match[1]) * 60 + Number(match[2]) + minutes + 24 * 60) % (24 * 60)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export default AppointmentFormModal
