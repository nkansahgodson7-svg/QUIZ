import type { LeaderRow } from '../lib/contract'

const MEDAL = ['bg-acid-400 text-night-950', 'bg-mist-100 text-night-950', 'bg-[#e0a96d] text-night-950']

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
      <p className="rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-mist-400">
        {emptyLabel}
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {visible.map((row) => {
        const isMe = highlight != null && row.nickname === highlight
        return (
          <li
            key={`${row.rank}-${row.nickname}`}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 sm:px-4 ${
              isMe
                ? 'border-acid-400/45 bg-acid-400/10'
                : 'border-white/8 bg-white/[0.035]'
            }`}
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-xl text-sm font-bold tabular-nums ${
                row.rank <= 3 ? MEDAL[row.rank - 1] : 'bg-white/8 text-mist-300'
              }`}
            >
              {row.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-mist-100">
              {row.nickname}
              {isMe && (
                <span className="ml-2 rounded-full bg-acid-400/15 px-2 py-0.5 text-[0.6rem] font-bold tracking-wider text-acid-300 uppercase">
                  you
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-mist-300">
              {row.score.toLocaleString()}
              <span className="ml-1 text-[0.65rem] font-medium tracking-wider text-mist-500 uppercase">
                pts
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
