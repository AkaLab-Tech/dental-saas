import { useEffect, useRef, useCallback } from 'react'
import { useLockStore } from '@/stores/lock.store'

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousemove',
  'keydown',
  'click',
  'touchstart',
  'scroll',
]

export function useInactivityTimer() {
  const autoLockMinutes = useLockStore((s) => s.autoLockMinutes)
  const isLocked = useLockStore((s) => s.isLocked)
  const lock = useLockStore((s) => s.lock)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    if (autoLockMinutes > 0 && !isLocked) {
      timerRef.current = setTimeout(() => {
        lock()
      }, autoLockMinutes * 60 * 1000)
    }
  }, [autoLockMinutes, isLocked, lock])

  useEffect(() => {
    if (autoLockMinutes <= 0 || isLocked) return

    resetTimer()

    const handler = () => resetTimer()
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handler, { passive: true })
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, handler)
      }
    }
  }, [autoLockMinutes, isLocked, resetTimer])

  return { resetTimer }
}
