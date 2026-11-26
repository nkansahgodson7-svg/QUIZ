import { Link } from 'react-router-dom'

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2" aria-label="Quizzly home">
      <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-extrabold text-paper">
        Q
      </span>
      {!compact && <span className="text-lg font-extrabold tracking-tight text-ink">Quizzly</span>}
    </Link>
  )
}
