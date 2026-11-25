import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5" aria-label="Quizzly home">
      <span className="grid size-9 place-items-center rounded-xl bg-acid-400 text-night-950 shadow-[0_0_28px_-4px_rgba(211,251,110,0.75)] transition-transform duration-200 group-hover:-rotate-6">
        <Zap className="size-5" strokeWidth={2.6} fill="currentColor" />
      </span>
      {!compact && (
        <span className="text-[1.35rem] leading-none font-bold tracking-tight text-mist-50">
          quizzly
        </span>
      )}
    </Link>
  )
}
