import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { setUserPin } from '@/lib/users-api'

export function PinSetupModal() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [pin, setPin] = useState(['', '', '', ''])
  const [confirmPin, setConfirmPin] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const currentPin = step === 'enter' ? pin : confirmPin
  const setCurrentPin = step === 'enter' ? setPin : setConfirmPin

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [step])

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newPin = [...currentPin]
    newPin[index] = value.slice(-1)
    setCurrentPin(newPin)
    setError('')

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-advance on last digit
    if (value && index === 3) {
      const fullPin = newPin.join('')
      if (fullPin.length === 4) {
        if (step === 'enter') {
          setStep('confirm')
        } else {
          handleSubmit(fullPin)
        }
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !currentPin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleSubmit = async (confirmedPin: string) => {
    const originalPin = pin.join('')
    if (originalPin !== confirmedPin) {
      setError(t('pin.mismatch'))
      setConfirmPin(['', '', '', ''])
      inputRefs.current[0]?.focus()
      return
    }

    if (!user) return
    setLoading(true)
    try {
      await setUserPin(user.id, originalPin)
      setUser({ ...user, hasPinSet: true })
    } catch {
      setError(t('pin.saveError'))
      setStep('enter')
      setPin(['', '', '', ''])
      setConfirmPin(['', '', '', ''])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-blue-100 mb-4">
          <Lock className="h-7 w-7 text-blue-600" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-1">{t('pin.setupTitle')}</h2>
        <p className="text-sm text-gray-500 mb-6">{t('pin.setupDescription')}</p>

        <p className="text-sm font-medium text-gray-700 mb-3">
          {step === 'enter' ? t('pin.enterNew') : t('pin.confirmPin')}
        </p>

        {/* PIN Inputs */}
        <div className="flex justify-center gap-3 mb-4">
          {currentPin.map((digit, i) => (
            <input
              key={`${step}-${i}`}
              ref={(el) => { inputRefs.current[i] = el }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
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

        {step === 'confirm' && !loading && (
          <button
            onClick={() => {
              setStep('enter')
              setPin(['', '', '', ''])
              setConfirmPin(['', '', '', ''])
              setError('')
            }}
            className="text-sm text-gray-500 hover:text-gray-700 mt-2"
          >
            {t('pin.startOver')}
          </button>
        )}
      </div>
    </div>
  )
}
