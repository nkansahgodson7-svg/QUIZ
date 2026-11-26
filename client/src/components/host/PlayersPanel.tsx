import { useState } from 'react'
import { WifiOff } from 'lucide-react'
import type { HostLiveState, HostPlayerStatus } from '../../lib/contract'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'answered', label: 'Answered' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'offline', label: 'Offline' },
] as const

type StatusFilter = (typeof FILTERS)[number]['id']

function StatusPill({ status }: { status: HostPlayerStatus }) {
  if (status === 'answered') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-correct/25 bg-correct-soft px-2 py-0.5 text-[0.65rem] font-bold text-correct">
        <span className="size-1.5 rounded-full bg-correct" />
        Answered
      </span>
    )
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.65rem] font-bold text-ink-3">
        <WifiOff className="size-3" />
        Offline
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.65rem] font-bold text-ink-3">
      <span className="size-1.5 rounded-full bg-line-strong" />
      Thinking…
    </span>
  )
}

export function PlayersPanel({
  liveState,
  playerCount,
}: {
  liveState: HostLiveState | null
  playerCount: number
}) {
  const [filter, setFilter] = useState<StatusFilter>('all')

  const players = liveState?.players ?? []
  const counts: Record<HostPlayerStatus, number> = {
    answered: players.filter((player) => player.status === 'answered').length,
    thinking: players.filter((player) => player.status === 'thinking').length,
    offline: players.filter((player) => player.status === 'offline').length,
  }
  const visible =
    filter === 'all' ? players : players.filter((player) => player.status === filter)

  const countFor = (id: StatusFilter) => (id === 'all' ? players.length : counts[id])

  return (
    <section className="card flex flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight">Players</h2>
          <p className="mt-0.5 text-xs font-semibold text-ink-3 tabular-nums" aria-live="polite">
            {counts.answered} answered · {counts.thinking} thinking
            {counts.offline > 0 && ` · ${counts.offline} offline`}
          </p>
        </div>
        <span className="tile px-2 py-1 text-xs tabular-nums">
          {liveState?.eligible ?? playerCount} in play
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map(({ id, label }) => {
          const active = filter === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[0.7rem] font-bold transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-paper text-ink-2 hover:border-line-strong'
              }`}
            >
              {label}
              <span className="tabular-nums">{countFor(id)}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-3">
          {players.length === 0
            ? 'Player status will appear here as the question runs.'
            : 'No players match this filter.'}
        </p>
      ) : (
        <ul className="mt-2 max-h-60 divide-y divide-line overflow-y-auto pr-1">
          {visible.map((player) => (
            <li key={player.playerId} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {player.nickname}
              </span>
              <span className="shrink-0 text-xs font-bold text-ink-3 tabular-nums">
                {player.totalScore.toLocaleString()} pts
              </span>
              <StatusPill status={player.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
