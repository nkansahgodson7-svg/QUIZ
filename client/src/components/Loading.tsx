import { Loader2 } from 'lucide-react'

/** Indeterminate spinner, sized by the caller. */
export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={`animate-spin ${className}`} />
}

/**
 * Small dot with a soft ping ring — used wherever the UI is waiting on
 * something (a socket, a player, the host) without blocking the screen.
 */
export function PulseDot({
  className = 'size-2',
  tone = 'bg-cobalt',
}: {
  className?: string
  tone?: string
}) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} aria-hidden="true">
      <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${tone}`} />
      <span className={`relative inline-flex size-full rounded-full ${tone}`} />
    </span>
  )
}

/** Shimmering placeholder block for content that has not arrived yet. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block rounded-md ${className}`} />
}
