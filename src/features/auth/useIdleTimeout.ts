import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Tracks inactivity across all open tabs (via localStorage) and signals a
 * warning before timing out. Activity during the warning does not cancel it;
 * the person must choose to stay signed in.
 */
const KEY = 'ems:last-activity'
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

function readLast(): number {
  const value = Number(localStorage.getItem(KEY))
  return Number.isFinite(value) && value > 0 ? value : Date.now()
}

function writeLast(time: number) {
  try {
    localStorage.setItem(KEY, String(time))
  } catch {
    // ignore
  }
}

export function useIdleTimeout({
  timeoutMs,
  warningMs,
  onTimeout,
  enabled = true,
}: {
  timeoutMs: number
  warningMs: number
  onTimeout: () => void
  enabled?: boolean
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const warningRef = useRef(false)
  const lastWrite = useRef(0)
  const onTimeoutRef = useRef(onTimeout)
  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  const stayActive = useCallback(() => {
    const now = Date.now()
    lastWrite.current = now
    writeLast(now)
    warningRef.current = false
    setSecondsLeft(null)
  }, [])

  useEffect(() => {
    if (!enabled) return
    lastWrite.current = Date.now()
    writeLast(lastWrite.current)

    const onActivity = () => {
      if (warningRef.current) return
      const now = Date.now()
      if (now - lastWrite.current > 5000) {
        lastWrite.current = now
        writeLast(now)
      }
    }
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    const timer = window.setInterval(() => {
      const idle = Date.now() - readLast()
      if (idle >= timeoutMs) {
        window.clearInterval(timer)
        onTimeoutRef.current()
      } else if (idle >= timeoutMs - warningMs) {
        warningRef.current = true
        setSecondsLeft(Math.ceil((timeoutMs - idle) / 1000))
      } else if (warningRef.current) {
        // Another tab reported activity.
        warningRef.current = false
        setSecondsLeft(null)
      }
    }, 1000)

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      window.clearInterval(timer)
    }
  }, [enabled, timeoutMs, warningMs])

  return { warning: secondsLeft !== null, secondsLeft: secondsLeft ?? 0, stayActive }
}
