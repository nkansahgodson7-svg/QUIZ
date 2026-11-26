export function TimerBar({
  seconds,
  progress,
  size = 'md',
}: {
  seconds: number
  progress: number
  size?: 'md' | 'lg'
}) {
  const clamped = Math.max(0, Math.min(1, progress))
  const urgent = seconds <= 5

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex-1 overflow-hidden rounded-full border border-line bg-paper ${
          size === 'lg' ? 'h-4' : 'h-3'
        }`}
        role="progressbar"
        aria-label="Time remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-100 ease-linear ${
            urgent ? 'bg-wrong' : 'bg-cobalt'
          }`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span
        className={`w-14 text-right font-bold tabular-nums ${
          size === 'lg' ? 'text-2xl' : 'text-lg'
        } ${urgent ? 'text-wrong' : 'text-ink'}`}
      >
        {seconds}s
      </span>
    </div>
  )
}
