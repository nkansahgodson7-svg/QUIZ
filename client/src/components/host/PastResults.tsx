import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw, Trophy } from 'lucide-react'
import { ErrorBanner } from '../ErrorBanner'
import { Skeleton, Spinner } from '../Loading'
import {
  describeApiError,
  fetchQuizzes,
  fetchSession,
  fetchSessions,
  type SessionDetail,
  type SessionPlayer,
  type SessionSummary,
} from '../../lib/api'

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

export function PastResults() {
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
    Promise.all([fetchSessions(), fetchQuizzes()])
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
  }, [reloadKey])

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
      const next = await fetchSession(session.id)
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
      <div className="animate-rise">
        <button
          type="button"
          onClick={closeDetail}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          All results
        </button>

        {detailLoading ? (
          <div role="status" aria-live="polite" className="mt-4">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
              <Spinner className="size-4 text-cobalt" />
              Loading the full leaderboard…
            </p>
            <div className="card mt-3 divide-y divide-line overflow-hidden">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-6 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        ) : detailError ? (
          <div className="mt-4">
            <ErrorBanner message={detailError} onDismiss={() => setDetailError(null)} />
          </div>
        ) : detail ? (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-balance">
                  {selectedSession ? titleFor(selectedSession) : 'Game results'}
                </h1>
                <p className="mt-1 text-sm text-ink-2 tabular-nums">
                  {formatDateTime(detail.endedAt)} · {detail.players.length} player
                  {detail.players.length === 1 ? '' : 's'} · Room {detail.code}
                </p>
              </div>
              {duration && <span className="tile">{duration}</span>}
            </div>

            <div className="card mt-5 overflow-hidden">
              <div className="grid grid-cols-[2.25rem_1fr_auto_1.5rem] items-center gap-3 border-b border-line bg-paper px-4 py-2.5 text-xs font-bold text-ink-3">
                <span>Rank</span>
                <span>Player</span>
                <span className="text-right">Score</span>
                <span />
              </div>

              {ranked.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-2">
                  No players were saved for this game.
                </p>
              ) : (
                <ol className="divide-y divide-line">
                  {ranked.map((player) => {
                    const expanded = expandedPlayerId === player.playerId
                    const answers = [...player.answers].sort(
                      (a, b) => a.questionIndex - b.questionIndex,
                    )
                    return (
                      <li key={player.playerId}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPlayerId((current) =>
                              current === player.playerId ? null : player.playerId,
                            )
                          }
                          aria-expanded={expanded}
                          className="grid w-full grid-cols-[2.25rem_1fr_auto_1.5rem] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper"
                        >
                          <span
                            className={`grid size-6 place-items-center rounded text-xs font-extrabold tabular-nums ${
                              player.rank <= 3 ? 'bg-ink text-paper' : 'text-ink-2'
                            }`}
                          >
                            {player.rank}
                          </span>
                          <span className="truncate text-sm font-semibold">{player.nickname}</span>
                          <span className="text-sm font-bold text-ink-2 tabular-nums">
                            {player.totalScore.toLocaleString()}
                          </span>
                          <ChevronDown
                            className={`size-4 text-ink-3 transition-transform ${
                              expanded ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {expanded && (
                          <div className="border-t border-line bg-paper px-4 py-3">
                            {answers.length === 0 ? (
                              <p className="text-xs text-ink-3">No answers recorded.</p>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {answers.map((answer) => (
                                  <div
                                    key={answer.questionIndex}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-3 py-1.5 text-xs"
                                  >
                                    <span className="font-bold text-ink-2 tabular-nums">
                                      Q{answer.questionIndex + 1}
                                    </span>
                                    <span
                                      className={`font-semibold ${
                                        answer.correct ? 'text-correct' : 'text-wrong'
                                      }`}
                                    >
                                      {answer.correct
                                        ? 'Correct'
                                        : answer.choiceIndex == null
                                          ? 'No answer'
                                          : 'Wrong'}
                                    </span>
                                    {answer.choiceIndex != null && (
                                      <span className="text-ink-3">
                                        Choice {String.fromCharCode(65 + answer.choiceIndex)}
                                      </span>
                                    )}
                                    {answer.responseMs != null && (
                                      <span className="text-ink-3 tabular-nums">
                                        {(answer.responseMs / 1000).toFixed(1)}s
                                      </span>
                                    )}
                                    <span className="ml-auto font-bold text-ink tabular-nums">
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
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">Past results</h2>
        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          disabled={loading}
          className="btn-ghost px-3.5 py-2.5 text-sm"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mt-3">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </div>

      {loading && sessions.length === 0 ? (
        <div role="status" aria-live="polite" className="card mt-4 divide-y divide-line overflow-hidden">
          <span className="sr-only">Loading past games…</span>
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="grid gap-3 px-4 py-3.5 sm:grid-cols-[1fr_9rem_6rem_8rem] sm:items-center"
            >
              <div className="min-w-0">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="mt-1.5 h-3 w-20" />
              </div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-16" />
              <div className="sm:text-right">
                <Skeleton className="h-9 w-28 sm:ml-auto" />
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border border-line bg-paper text-ink-2">
            <Trophy className="size-5" />
          </span>
          <p className="mt-4 text-base font-bold">No finished games yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-2">
            Run a quiz with your class and the full results land here automatically.
          </p>
        </div>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <div className="hidden grid-cols-[1fr_9rem_6rem_8rem] gap-3 border-b border-line bg-paper px-4 py-2.5 text-xs font-bold text-ink-3 sm:grid">
            <span>Quiz</span>
            <span>Finished</span>
            <span>Players</span>
            <span className="text-right">Leaderboard</span>
          </div>
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="grid gap-3 px-4 py-3.5 sm:grid-cols-[1fr_9rem_6rem_8rem] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-bold">{titleFor(session)}</p>
                  <p className="mt-0.5 text-xs text-ink-3 tabular-nums">Room {session.code}</p>
                </div>
                <p className="text-xs text-ink-2 tabular-nums">{formatDateTime(session.endedAt)}</p>
                <p className="text-xs text-ink-2 tabular-nums">
                  {session.playerCount} player{session.playerCount === 1 ? '' : 's'}
                </p>
                <div className="sm:text-right">
                  <button
                    type="button"
                    onClick={() => void openSession(session)}
                    className="btn-ghost px-3 py-2 text-sm"
                  >
                    View results
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
