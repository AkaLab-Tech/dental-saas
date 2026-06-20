import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LogOut, ArrowLeft, Lock } from 'lucide-react'
import { useLockStore } from '@/stores/lock.store'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api'
import type { ProfileUser } from '@/lib/api'

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-800',
  ADMIN: 'bg-blue-100 text-blue-800',
  CLINIC_ADMIN: 'bg-indigo-100 text-indigo-800',
  DOCTOR: 'bg-green-100 text-green-800',
  STAFF: 'bg-gray-100 text-gray-800',
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  CLINIC_ADMIN: 'Clinic Admin',
  DOCTOR: 'Doctor',
  STAFF: 'Staff',
}

type PinStep = 'enter' | 'setup-enter' | 'setup-confirm'

export function LockScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const profiles = useLockStore((s) => s.profiles) || []
  const pinLogin = useLockStore((s) => s.pinLogin)
  const setupPinAction = useLockStore((s) => s.setupPin)
  const fetchProfiles = useLockStore((s) => s.fetchProfiles)
  const { user, logout, refreshToken } = useAuthStore()

  const [selectedProfile, setSelectedProfile] = useState<ProfileUser | null>(null)
  const [step, setStep] = useState<PinStep>('enter')
  const [pin, setPin] = useState(['', '', '', ''])
  const [setupPinValue, setSetupPinValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Fetch profiles on mount if empty
  useEffect(() => {
    if (profiles.length === 0) {
      fetchProfiles()
    }
  }, [profiles.length, fetchProfiles])

  useEffect(() => {
    if (selectedProfile) {
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    }
  }, [selectedProfile, step])

  const resetPinInput = () => {
    setPin(['', '', '', ''])
    setTimeout(() => inputRefs.current[0]?.focus(), 50)
  }

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newPin = [...pin]
    newPin[index] = value.slice(-1)
    setPin(newPin)
    setError('')

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-action on 4th digit
    if (value && index === 3) {
      const fullPin = newPin.join('')
      if (fullPin.length === 4) {
        handlePinComplete(fullPin)
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePinComplete = async (fullPin: string) => {
    if (!selectedProfile || loading) return

    if (step === 'enter') {
      // Existing PIN — login
      setLoading(true)
      try {
        await pinLogin(selectedProfile.id, fullPin)
      } catch {
        setError(t('lock.wrongPin'))
        setShake(true)
        setTimeout(() => setShake(false), 500)
        resetPinInput()
      } finally {
        setLoading(false)
      }
    } else if (step === 'setup-enter') {
      // New PIN setup — save and move to confirm
      setSetupPinValue(fullPin)
      setStep('setup-confirm')
      setPin(['', '', '', ''])
    } else if (step === 'setup-confirm') {
      // Confirm PIN
      if (fullPin !== setupPinValue) {
        setError(t('pin.mismatch'))
        setShake(true)
        setTimeout(() => setShake(false), 500)
        resetPinInput()
        return
      }
      // Save PIN via setup-pin endpoint (sets PIN + returns profileToken)
      setLoading(true)
      try {
        await setupPinAction(selectedProfile.id, fullPin)
      } catch {
        setError(t('pin.saveError'))
        setStep('setup-enter')
        setSetupPinValue('')
        resetPinInput()
      } finally {
        setLoading(false)
      }
    }
  }

  const handleBack = () => {
    setSelectedProfile(null)
    setPin(['', '', '', ''])
    setSetupPinValue('')
    setStep('enter')
    setError('')
  }

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken)
      }
    } catch {
      // Ignore
    } finally {
      logout()
      navigate('/login')
    }
  }

  const handleSelectProfile = (profile: ProfileUser) => {
    setSelectedProfile(profile)
    setError('')
    setPin(['', '', '', ''])
    setSetupPinValue('')
    setStep(profile.hasPinSet ? 'enter' : 'setup-enter')
  }

  const getStepLabel = () => {
    switch (step) {
      case 'enter':
        return t('lock.enterPin')
      case 'setup-enter':
        return t('pin.enterNew')
      case 'setup-confirm':
        return t('pin.confirmPin')
      default:
        return ''
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-blue-600 mb-4">
          <Lock className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          {user?.tenant?.name || 'Alveo'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t('lock.selectProfile')}</p>
      </div>

      {selectedProfile ? (
        /* PIN Input View */
        <div className="w-full max-w-sm">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('common.back')}
          </button>

          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            {/* Avatar */}
            <div className="flex justify-center mb-4">
              {selectedProfile.avatar ? (
                <img
                  src={selectedProfile.avatar}
                  alt={selectedProfile.firstName}
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-blue-600 flex items-center justify-center">
                  <span className="text-2xl font-semibold text-white">
                    {selectedProfile.firstName[0]}
                    {selectedProfile.lastName[0]}
                  </span>
                </div>
              )}
            </div>

            <h2 className="text-lg font-semibold text-gray-900">
              {selectedProfile.firstName} {selectedProfile.lastName}
            </h2>
            <span
              className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${ROLE_COLORS[selectedProfile.role] || 'bg-gray-100 text-gray-800'}`}
            >
              {ROLE_LABELS[selectedProfile.role] || selectedProfile.role}
            </span>

            {/* Setup notice */}
            {(step === 'setup-enter' || step === 'setup-confirm') && (
              <p className="text-xs text-amber-600 mt-3">{t('pin.setupDescription')}</p>
            )}

            <p className="text-sm text-gray-500 mt-4 mb-4">{getStepLabel()}</p>

            {/* PIN Inputs */}
            <div
              className={`flex justify-center gap-3 mb-4 ${shake ? 'animate-shake' : ''}`}
            >
              {pin.map((digit, i) => (
                <input
                  key={`${step}-${i}`}
                  ref={(el) => { inputRefs.current[i] = el }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={loading}
                  className="w-14 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all disabled:opacity-50"
                />
              ))}
            </div>

            {error && (
              <p className="text-sm text-red-600 mb-2">{error}</p>
            )}

            {loading && (
              <p className="text-sm text-gray-500">{t('common.loading')}</p>
            )}

            {step === 'setup-confirm' && !loading && (
              <button
                onClick={() => {
                  setStep('setup-enter')
                  setSetupPinValue('')
                  setPin(['', '', '', ''])
                  setError('')
                }}
                className="text-sm text-gray-500 hover:text-gray-700 mt-2"
              >
                {t('pin.startOver')}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Profile Grid */
        <div className="w-full max-w-4xl">
          <div className="flex flex-wrap justify-center gap-4">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => handleSelectProfile(profile)}
                className="bg-white rounded-2xl shadow-md hover:shadow-lg transition-shadow p-6 text-center group w-36"
              >
                {/* Avatar */}
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile.firstName}
                    className="h-16 w-16 rounded-full object-cover mx-auto mb-3"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-3 group-hover:bg-blue-700 transition-colors">
                    <span className="text-xl font-semibold text-white">
                      {profile.firstName[0]}
                      {profile.lastName[0]}
                    </span>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-900 truncate">
                  {profile.firstName} {profile.lastName}
                </h3>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${ROLE_COLORS[profile.role] || 'bg-gray-100 text-gray-800'}`}
                >
                  {ROLE_LABELS[profile.role] || profile.role}
                </span>

                {!profile.hasPinSet && (
                  <p className="text-xs text-amber-500 mt-2">{t('lock.noPinShort')}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Logout link */}
      <button
        onClick={handleLogout}
        className="mt-8 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        {t('lock.fullLogout')}
      </button>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  )
}
