import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Trophy,
  Users,
} from 'lucide-react'
import { ErrorBanner } from '../ErrorBanner'
import {
  describeApiError,
  fetchQuizzes,
  fetchSession,
  fetchSessions,
  type SessionDetail,
  type SessionPlayer,
  type SessionSummary,
} from '../../lib/api'

const MEDAL = [
  'bg-acid-400 text-night-950',
  'bg-mist-100 text-night-950',
  'bg-[#e0a96d] text-night-950',
]

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDuration(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''
  const minutes = Math.max(1, Math.round((end - start) / 60000))
  return `${minutes} min`
}

function rankPlayers(players: SessionPlayer[]): Array<SessionPlayer & { rank: number }> {
  const sorted = [...players].sort(
    (a, b) => b.totalScore - a.totalScore || a.nickname.localeCompare(b.nickname),
  )
  let previousScore: number | null = null
  let previousRank = 0
  return sorted.map((player, index) => {
    const rank =
      previousScore !== null && player.totalScore === previousScore ? previousRank : index + 1
    previousScore = player.totalScore
    previousRank = rank
    return { ...player, rank }
  })
}

export function PastResults({ token }: { token: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [quizTitles, setQuizTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)
  const detailRequest = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchSessions(token), fetchQuizzes(token)])
      .then(([nextSessions, quizzes]) => {
        if (cancelled) return
        setSessions(nextSessions)
        setQuizTitles(
          Object.fromEntries(quizzes.map((quiz) => [quiz.id, quiz.title])),
        )
      })
      .catch((loadError) => {
        if (!cancelled) setError(describeApiError(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey])

  useEffect(
    () => () => {
      detailRequest.current += 1
    },
    [],
  )

  function titleFor(session: SessionSummary): string {
    return session.quizTitle || quizTitles[session.quizId] || 'Quiz no longer saved'
  }

  async function openSession(session: SessionSummary) {
    const requestId = detailRequest.current + 1
    detailRequest.current = requestId
    setSelectedId(session.id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setExpandedPlayerId(null)
    try {
      const next = await fetchSession(token, session.id)
      if (detailRequest.current === requestId) setDetail(next)
    } catch (loadError) {
      if (detailRequest.current === requestId) setDetailError(describeApiError(loadError))
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false)
    }
  }

  function closeDetail() {
    detailRequest.current += 1
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
    setExpandedPlayerId(null)
  }

  if (selectedId) {
    const selectedSession = sessions.find((session) => session.id === selectedId) ?? null
    const ranked = detail ? rankPlayers(detail.players) : []
    const duration = detail ? formatDuration(detail.startedAt, detail.endedAt) : ''

    return (
      <div className="mx-auto w-full max-w-4xl py-6 animate-rise">
        <button
          type="button"
          onClick={closeDetail}
          className="inline-flex items-center gap-1.5 text-sm text-mist-400 transition-colors hover:text-mist-200"
        >
          <ArrowLeft className="size-4" />
          All results
        </button>

        {detailLoading ? (
          <div className="panel mt-5 flex items-center justify-center gap-2 px-5 py-16 text-sm text-mist-400">
            <Loader2 className="size-4 animate-spin" />
            Loading the full leaderboard…
          </div>
        ) : detailError ? (
          <div className="mt-5">
            <ErrorBanner message={detailError} onDismiss={() => setDetailError(null)} />
          </div>
        ) : detail ? (
          <>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Room {detail.code} · final results</p>
                <h1 className="mt-2 text-4xl font-bold tracking-tight text-balance">
                  {selectedSession ? titleFor(selectedSession) : 'Game results'}
                </h1>
                <p className="mt-2 text-sm text-mist-400">
                  {formatDateTime(detail.endedAt)} · {detail.players.length} player
                  {detail.players.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-medium text-mist-300 tabular-nums">
                  Room {detail.code}
                </span>
                {duration && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-medium text-mist-300">
                    {duration}
                  </span>
                )}
              </div>
            </div>

            <div className="panel mt-6 p-5 sm:p-7">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="eyebrow">Full leaderboard</p>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.14em] text-mist-400 uppercase">
                  Host view
                </span>
              </div>

              {ranked.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-mist-400">
                  No players were saved for this game.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {ranked.map((player) => {
                    const expanded = expandedPlayerId === player.playerId
                    const answers = [...player.answers].sort(
                      (a, b) => a.questionIndex - b.questionIndex,
                    )
                    return (
                      <li
                        key={player.playerId}
                        className="rounded-2xl border border-white/8 bg-white/[0.035]"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPlayerId((current) =>
                              current === player.playerId ? null : player.playerId,
                            )
                          }
                          aria-expanded={expanded}
                          className="flex w-full items-center gap-3 px-3 py-3 text-left sm:px-4"
                        >
                          <span
                            className={`grid size-8 shrink-0 place-items-center rounded-xl text-sm font-bold tabular-nums ${
                              player.rank <= 3 ? MEDAL[player.rank - 1] : 'bg-white/8 text-mist-300'
                            }`}
                          >
                            {player.rank}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium text-mist-100">
                            {player.nickname}
                          </span>
                          <span className="shrink-0 font-semibold text-mist-300 tabular-nums">
                            {player.totalScore.toLocaleString()}
                            <span className="ml-1 text-[0.65rem] font-medium tracking-wider text-mist-500 uppercase">
                              pts
                            </span>
                          </span>
                          <ChevronDown
                            className={`size-4 shrink-0 text-mist-500 transition-transform ${
                              expanded ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {expanded && (
                          <div className="border-t border-white/8 px-3 py-3 sm:px-4">
                            <p className="eyebrow">Question breakdown</p>
                            {answers.length === 0 ? (
                              <p className="mt-2 text-xs text-mist-500">No answers recorded.</p>
                            ) : (
                              <div className="mt-2 flex flex-col gap-1.5">
                                {answers.map((answer) => (
                                  <div
                                    key={answer.questionIndex}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-night-950/40 px-3 py-2 text-xs"
                                  >
                                    <span className="font-semibold text-mist-300 tabular-nums">
                                      Q{answer.questionIndex + 1}
                                    </span>
                                    <span
                                      className={
                                        answer.correct ? 'text-acid-300' : 'text-coral-400'
                                      }
                                    >
                                      {answer.correct
                                        ? 'Correct'
                                        : answer.choiceIndex == null
                                          ? 'No answer'
                                          : 'Wrong'}
                                    </span>
                                    {answer.choiceIndex != null && (
                                      <span className="text-mist-500">
                                        Choice {String.fromCharCode(65 + answer.choiceIndex)}
                                      </span>
                                    )}
                                    {answer.responseMs != null && (
                                      <span className="text-mist-500 tabular-nums">
                                        {(answer.responseMs / 1000).toFixed(1)}s
                                      </span>
                                    )}
                                    <span className="ml-auto font-semibold text-mist-200 tabular-nums">
                                      +{answer.points}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            <p className="mt-5 text-center text-xs leading-relaxed text-mist-500">
              Expand any player to see their choice, correctness, response time, and points for
              every question.
            </p>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-mist-100">Past results</h2>
          <p className="mt-1 text-sm text-mist-400">
            Every finished game, with the full leaderboard and per-question scores.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          disabled={loading}
          className="btn-ghost px-4 py-2.5 text-sm"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </div>

      {loading && sessions.length === 0 ? (
        <div className="panel flex items-center justify-center gap-2 px-5 py-12 text-sm text-mist-400">
          <Loader2 className="size-4 animate-spin" />
          Loading past games…
        </div>
      ) : sessions.length === 0 ? (
        <div className="panel px-6 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-acid-400/12 text-acid-300">
            <Trophy className="size-6" />
          </span>
          <p className="mt-4 font-semibold text-mist-100">No finished games yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-mist-400">
            Play a quiz with your class and the full results will land here automatically.
          </p>
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id} className="panel p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-mist-100">
                      {titleFor(session)}
                    </h2>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.12em] text-mist-400 uppercase tabular-nums">
                      Room {session.code}
                    </span>
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist-500">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      {formatDateTime(session.endedAt)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {session.playerCount} player{session.playerCount === 1 ? '' : 's'}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void openSession(session)}
                  className="btn-ghost px-4 py-2.5 text-sm"
                >
                  View results
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
