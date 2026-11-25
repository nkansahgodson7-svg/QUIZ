const SIZE = {
  md: 'size-20',
  lg: 'size-28',
} as const

export function TimerRing({
  seconds,
  progress,
  size = 'md',
  label = 'sec',
}: {
  seconds: number
  progress: number
  size?: keyof typeof SIZE
  label?: string
}) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)))
  const urgent = seconds <= 5

  return (
    <div className={`relative ${SIZE[size]} shrink-0`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={urgent ? 'var(--color-coral-400)' : 'var(--color-acid-400)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 120ms linear, stroke 200ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          key={seconds}
          className={`animate-tick font-bold tabular-nums ${urgent ? 'text-coral-400' : 'text-mist-50'} ${
            size === 'lg' ? 'text-4xl' : 'text-3xl'
          }`}
        >
          {seconds}
        </span>
        <span className="text-[0.6rem] font-semibold tracking-[0.16em] text-mist-400 uppercase">
          {label}
        </span>
      </div>
    </div>
  )
}

export function TimerBar({ seconds, progress }: { seconds: number; progress: number }) {
  const urgent = seconds <= 5
  return (
    <div className="flex items-center gap-4">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-150 ease-linear ${
            urgent ? 'bg-coral-400' : 'bg-acid-400'
          }`}
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>
      <span
        key={seconds}
        className={`animate-tick w-16 text-right text-2xl font-bold tabular-nums ${
          urgent ? 'text-coral-400' : 'text-mist-50'
        }`}
      >
        {seconds}s
      </span>
    </div>
  )
}
