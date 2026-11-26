import type { LeaderRow } from '../lib/contract'

export function Leaderboard({
  rows,
  highlight,
  limit,
  emptyLabel = 'No scores yet',
}: {
  rows: LeaderRow[]
  highlight?: string
  limit?: number
  emptyLabel?: string
}) {
  const visible = typeof limit === 'number' ? rows.slice(0, limit) : rows

  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">
        {emptyLabel}
      </p>
    )
  }

  return (
    <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
      {visible.map((row) => {
        const isMe = highlight != null && row.nickname === highlight
        return (
          <li
            key={row.playerId}
            className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${isMe ? 'bg-cobalt-soft' : ''}`}
          >
            <span
              className={`w-7 shrink-0 text-center text-sm font-bold tabular-nums ${
                row.rank <= 3 ? 'text-ink' : 'text-ink-3'
              }`}
            >
              {row.rank}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-base font-semibold text-ink">{row.nickname}</span>
              {isMe && (
                <span className="shrink-0 rounded bg-cobalt px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide text-white uppercase">
                  You
                </span>
              )}
            </span>
            <span className="shrink-0 text-base font-bold tabular-nums text-ink-2">
              {row.totalScore.toLocaleString()}
              <span className="ml-1 text-xs font-semibold text-ink-3">pts</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
