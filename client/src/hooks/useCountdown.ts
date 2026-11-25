import { useEffect, useState } from 'react'

export interface Countdown {
  remainingMs: number
  /** 0..1, how much of the question window is left. */
  progress: number
  seconds: number
  /** False during the short lead-in before the server's startsAt. */
  started: boolean
  ended: boolean
}

export function useCountdown(startsAt: number | null, durationMs: number | null): Countdown {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startsAt == null || durationMs == null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [startsAt, durationMs])

  if (startsAt == null || durationMs == null) {
    return { remainingMs: 0, progress: 0, seconds: 0, started: false, ended: false }
  }

  const remainingMs = Math.min(durationMs, Math.max(0, startsAt + durationMs - now))
  return {
    remainingMs,
    progress: durationMs > 0 ? remainingMs / durationMs : 0,
    seconds: Math.ceil(remainingMs / 1000),
    started: now >= startsAt,
    ended: remainingMs <= 0,
  }
}
