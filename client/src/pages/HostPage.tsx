import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ListChecks, Play, RotateCcw, Trophy, WifiOff } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { LiveConsole } from '../components/host/LiveConsole'
import { PastResults } from '../components/host/PastResults'
import { QuizBuilder } from '../components/host/QuizBuilder'
import { SavedQuizzes } from '../components/host/SavedQuizzes'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { PulseDot, Spinner } from '../components/Loading'
import { Logo } from '../components/Logo'
import { useCountdown } from '../hooks/useCountdown'
import {
  deleteQuiz,
  describeApiError,
  fetchQuizzes,
  fetchServerInfo,
  type Quiz,
  type ServerInfo,
} from '../lib/api'
import {
  isHostGameEnded,
  type AnswerCount,
  type GameQuestion,
  type GameSocket,
  type HostLiveState,
  type LeaderRow,
} from '../lib/contract'
import { createSocket } from '../lib/socket'

type HostPhase = 'idle' | 'lobby' | 'live' | 'ended'
type DashboardTab = 'quizzes' | 'results'

export function HostPage() {
  const socketRef = useRef<GameSocket | null>(null)
  const copyTimer = useRef<number | null>(null)

  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [phase, setPhase] = useState<HostPhase>('idle')
  const [tab, setTab] = useState<DashboardTab>('quizzes')
  const [builderQuiz, setBuilderQuiz] = useState<Quiz | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)

  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [code, setCode] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [question, setQuestion] = useState<GameQuestion | null>(null)
  const [answered, setAnswered] = useState<AnswerCount | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [liveState, setLiveState] = useState<HostLiveState | null>(null)
  const [standings, setStandings] = useState<LeaderRow[]>([])
  const [questionEnded, setQuestionEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchServerInfo()
      .then((info) => {
        if (!cancelled) setServerInfo(info)
      })
      .catch(() => {
        /* the join URL falls back to this page's origin */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void reloadQuizzes()
  }, [])

  useEffect(() => {
    const socket = createSocket()
    socketRef.current = socket
    setConnection('connecting')

    socket.on('connect', () => setConnection('connected'))
    socket.on('disconnect', () => setConnection('offline'))
    socket.on('connect_error', () => setConnection('offline'))

    socket.on('room:created', ({ code: roomCode }) => {
      setCode(roomCode)
      setPlayerCount(0)
      setQuestion(null)
      setAnswered(null)
      setLeaderboard([])
      setLiveState(null)
      setStandings([])
      setQuestionEnded(false)
      setOpeningId(null)
      setError(null)
      setPhase('lobby')
    })
    socket.on('lobby:update', ({ playerCount: count }) => setPlayerCount(count))
    socket.on('game:question', (payload) => {
      setQuestion(payload)
      setAnswered(null)
      setLiveState(null)
      setQuestionEnded(false)
      setStarting(false)
      setPhase('live')
    })
    socket.on('game:answer_count', (payload) => setAnswered(payload))
    socket.on('host:live_state', (payload) => {
      setLiveState(payload)
      setAnswered({ index: payload.index, answered: payload.answered, total: payload.eligible })
    })
    socket.on('host:standings', (payload) => setStandings(payload.leaderboard))
    socket.on('game:ended', (payload) => {
      if (!isHostGameEnded(payload)) return
      setLeaderboard(payload.leaderboard)
      setStandings(payload.leaderboard)
      setPhase('ended')
    })
    socket.on('error', (payload) => {
      setOpeningId(null)
      setStarting(false)
      if (payload.code === 'AUTH_REQUIRED') {
        setError(
          'Host controls only work on the host computer. Open the app from localhost on the machine running the server.',
        )
        return
      }
      setError(payload.message)
    })

    socket.connect()
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const countdown = useCountdown(
    phase === 'live' ? (question?.startsAt ?? null) : null,
    phase === 'live' ? (question?.durationMs ?? null) : null,
  )

  const lanBase = (serverInfo?.lanUrl ?? window.location.origin).replace(/\/+$/, '')
  const hasRoomCode = /^\d{6}$/.test(code)
  const joinUrl = hasRoomCode ? `${lanBase}/?code=${code}` : null

  async function reloadQuizzes() {
    setQuizzesLoading(true)
    try {
      setQuizzes(await fetchQuizzes())
    } catch (loadError) {
      setError(describeApiError(loadError))
    } finally {
      setQuizzesLoading(false)
    }
  }

  async function copyText(value: string, kind: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800)
    } catch {
      setError('Could not copy to the clipboard. Select the code and copy it manually.')
    }
  }

  function resetSession() {
    setPhase('idle')
    setCode('')
    setPlayerCount(0)
    setQuestion(null)
    setAnswered(null)
    setLeaderboard([])
    setLiveState(null)
    setStandings([])
    setQuestionEnded(false)
    setStarting(false)
    setBuilderOpen(false)
    setBuilderQuiz(null)
    setTab('quizzes')
    setOpeningId(null)
    setDeletingId(null)
    setError(null)
    setCopied(null)
    void reloadQuizzes()
  }

  function openRoom(quiz: Quiz) {
    const socket = socketRef.current
    if (!socket || connection !== 'connected') {
      setError('The host connection is not ready yet. Wait a moment and try again.')
      return
    }
    setError(null)
    setOpeningId(quiz.id)
    socket.emit('host:create_room', { quizId: quiz.id })
  }

  function startGame() {
    if (!socketRef.current || !code || starting) return
    setError(null)
    setStarting(true)
    socketRef.current.emit('host:start', { code })
  }

  function endQuestionNow() {
    if (!socketRef.current || !code || questionEnded) return
    setQuestionEnded(true)
    socketRef.current.emit('host:end_question', { code })
  }

  function endGameNow() {
    if (!socketRef.current || !code) return
    if (!window.confirm('End the game now? Final standings will be saved.')) return
    socketRef.current.emit('host:end_game', { code })
  }

  function openBuilder(quiz: Quiz | null) {
    setBuilderQuiz(quiz)
    setBuilderOpen(true)
    setError(null)
  }

  function closeBuilder() {
    setBuilderOpen(false)
    setBuilderQuiz(null)
  }

  function handleQuizSaved(saved: Quiz) {
    setBuilderOpen(false)
    setBuilderQuiz(null)
    setTab('quizzes')
    setQuizzes((current) => {
      const exists = current.some((quiz) => quiz.id === saved.id)
      return exists
        ? current.map((quiz) => (quiz.id === saved.id ? saved : quiz))
        : [saved, ...current]
    })
    void reloadQuizzes()
  }

  async function handleDelete(quiz: Quiz) {
    if (!window.confirm(`Delete “${quiz.title}”? This cannot be undone.`)) return
    setDeletingId(quiz.id)
    setError(null)
    try {
      await deleteQuiz(quiz.id)
      setQuizzes((current) => current.filter((item) => item.id !== quiz.id))
    } catch (deleteFailure) {
      setError(describeApiError(deleteFailure))
    } finally {
      setDeletingId(null)
    }
  }

  function renderContent() {
    if (phase === 'lobby') {
      return (
        <LobbyView
          code={code}
          playerCount={playerCount}
          joinUrl={joinUrl}
          copied={copied}
          onCopy={copyText}
          onStart={startGame}
          starting={starting}
          online={connection === 'connected'}
        />
      )
    }

    if (phase === 'live' && question) {
      return (
        <LiveConsole
          code={code}
          question={question}
          answered={answered}
          liveState={liveState}
          standings={standings}
          playerCount={playerCount}
          seconds={countdown.seconds}
          progress={countdown.progress}
          locked={questionEnded || countdown.ended}
          copied={copied === 'code'}
          online={connection === 'connected'}
          onCopyCode={() => void copyText(code, 'code')}
          onEndQuestion={endQuestionNow}
          onEndGame={endGameNow}
        />
      )
    }

    if (phase === 'ended') {
      return <EndedView code={code} leaderboard={leaderboard} onNewRoom={resetSession} />
    }

    if (builderOpen) {
      return (
        <QuizBuilder
          key={builderQuiz?.id ?? 'new-quiz'}
          quiz={builderQuiz}
          onSaved={handleQuizSaved}
          onCancel={closeBuilder}
        />
      )
    }

    return (
      <div className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your quizzes</h1>
            <p className="mt-1 text-sm text-ink-2">
              Open a room, edit a quiz, or check how the last game went.
            </p>
          </div>
          <div className="flex w-full rounded-xl border border-line bg-card p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setTab('quizzes')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors sm:flex-none ${
                tab === 'quizzes' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <ListChecks className="size-4" />
              Quizzes
            </button>
            <button
              type="button"
              onClick={() => setTab('results')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors sm:flex-none ${
                tab === 'results' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Trophy className="size-4" />
              Past Results
            </button>
          </div>
        </div>

        <div className="mt-6">
          {tab === 'quizzes' ? (
            <SavedQuizzes
              quizzes={quizzes}
              loading={quizzesLoading}
              connection={connection}
              openingId={openingId}
              deletingId={deletingId}
              onOpen={openRoom}
              onEdit={(quiz) => openBuilder(quiz)}
              onDelete={(quiz) => void handleDelete(quiz)}
              onCreate={() => openBuilder(null)}
            />
          ) : (
            <PastResults />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="hidden rounded-md border border-line bg-card px-2 py-1 text-xs font-bold text-ink-2 sm:inline">
              Host
            </span>
            {code && phase !== 'idle' && (
              <span className="hidden rounded-md border border-line bg-card px-2 py-1 text-xs font-bold text-ink-2 tabular-nums sm:inline">
                Room {code}
              </span>
            )}
          </div>
          <ConnectionPill state={connection} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {connection === 'offline' && phase !== 'idle' && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-sm font-semibold text-warn">
            <WifiOff className="size-4 shrink-0" />
            Connection lost — reconnecting. The game keeps running on the server.
          </div>
        )}

        {renderContent()}
      </main>
    </div>
  )
}

function LobbyView({
  code,
  playerCount,
  joinUrl,
  copied,
  onCopy,
  onStart,
  starting,
  online,
}: {
  code: string
  playerCount: number
  joinUrl: string | null
  copied: 'code' | 'link' | null
  onCopy: (value: string, kind: 'code' | 'link') => void
  onStart: () => void
  starting: boolean
  online: boolean
}) {
  const digits = code.padStart(6, '0').split('')

  return (
    <div className="mx-auto my-auto w-full max-w-3xl py-4 animate-rise">
      <p className="text-sm font-bold text-ink-2">Room code</p>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="flex gap-1.5 sm:gap-2">
          {digits.map((digit, index) => (
            <span
              key={index}
              className="grid h-14 w-9 place-items-center rounded-xl border-2 border-ink bg-card text-3xl font-extrabold tabular-nums sm:h-24 sm:w-16 sm:text-5xl"
            >
              {digit}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onCopy(code, 'code')}
          className="btn-ghost px-3 py-2 text-sm"
        >
          {copied === 'code' ? (
            <Check className="size-4 text-correct" />
          ) : (
            <Copy className="size-4" />
          )}
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
      </div>

      <div className="card mt-6 flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">Players join at</p>
          <p className="mt-1 break-all text-base font-semibold text-cobalt">
            {joinUrl ?? 'The join link appears once the room code is ready.'}
          </p>
          <button
            type="button"
            onClick={() => joinUrl && onCopy(joinUrl, 'link')}
            disabled={!joinUrl}
            className="btn-ghost mt-3 px-3 py-2 text-sm"
          >
            {copied === 'link' ? (
              <Check className="size-4 text-correct" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied === 'link' ? 'Copied' : 'Copy join link'}
          </button>
        </div>
        {joinUrl && (
          <div className="shrink-0 self-center rounded-xl border border-line bg-white p-3">
            <QRCodeSVG
              value={joinUrl}
              size={148}
              marginSize={0}
              level="M"
              bgColor="#ffffff"
              fgColor="#141413"
              title={`QR code to join room ${code}`}
            />
          </div>
        )}
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-bold text-ink-2">Players in the room</p>
          <p
            key={playerCount}
            className="mt-1 text-5xl leading-none font-extrabold tabular-nums sm:text-6xl animate-pop"
          >
            {playerCount}
          </p>
          {playerCount === 0 && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-3">
              <PulseDot className="size-1.5" tone="bg-warn" />
              Waiting for the first player to join.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={!online || starting}
          className="btn-primary w-full px-6 py-4 text-base sm:w-auto"
        >
          {starting ? (
            <Spinner className="size-4" />
          ) : (
            <Play className="size-4" fill="currentColor" />
          )}
          {starting ? 'Starting…' : 'Start game'}
        </button>
      </div>
    </div>
  )
}

function EndedView({
  code,
  leaderboard,
  onNewRoom,
}: {
  code: string
  leaderboard: LeaderRow[]
  onNewRoom: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl py-4 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Final standings</h1>
          <p className="mt-1 text-sm text-ink-2 tabular-nums">
            Room {code} · {leaderboard.length} player{leaderboard.length === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" onClick={onNewRoom} className="btn-ghost px-4 py-2.5 text-sm">
          <RotateCcw className="size-4" />
          New room
        </button>
      </div>

      <div className="card mt-5 p-4 sm:p-6">
        <Leaderboard rows={leaderboard} emptyLabel="No players finished this game" />
      </div>

      <p className="mt-3 text-xs text-ink-3">
        Players see their own rank and the top 5. This screen has the full leaderboard.
      </p>
    </div>
  )
}
