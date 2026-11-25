import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  ListChecks,
  Loader2,
  LogOut,
  Play,
  RotateCcw,
  Trophy,
  Users,
  WifiOff,
} from 'lucide-react'
import { AuthView, type AuthMode } from '../components/host/AuthView'
import { PastResults } from '../components/host/PastResults'
import { QuizBuilder } from '../components/host/QuizBuilder'
import { SavedQuizzes } from '../components/host/SavedQuizzes'
import { Backdrop } from '../components/Backdrop'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { Logo } from '../components/Logo'
import { TimerBar } from '../components/Timer'
import { useCountdown } from '../hooks/useCountdown'
import {
  deleteQuiz,
  describeApiError,
  fetchMe,
  fetchQuizzes,
  login,
  signup,
  type HostAccount,
  type Quiz,
} from '../lib/api'
import {
  isHostGameEnded,
  type AnswerCount,
  type GameQuestion,
  type GameSocket,
  type LeaderRow,
} from '../lib/contract'
import { clearHostToken, loadHostToken, saveHostToken } from '../lib/host-storage'
import { createSocket } from '../lib/socket'

type AuthStatus = 'checking' | 'anonymous' | 'authenticated'
type HostPhase = 'idle' | 'lobby' | 'live' | 'ended'
type DashboardTab = 'quizzes' | 'results'

const OPTION_ACCENTS = [
  'bg-iris-500 text-white',
  'bg-aqua-400 text-night-950',
  'bg-coral-400 text-night-950',
  'bg-acid-400 text-night-950',
]

export function HostPage() {
  const socketRef = useRef<GameSocket | null>(null)
  const copyTimer = useRef<number | null>(null)

  const [storedToken] = useState(() => loadHostToken())
  const [token, setToken] = useState(storedToken)
  const [host, setHost] = useState<HostAccount | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    storedToken ? 'checking' : 'anonymous',
  )
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [phase, setPhase] = useState<HostPhase>('idle')
  const [tab, setTab] = useState<DashboardTab>('quizzes')
  const [builderQuiz, setBuilderQuiz] = useState<Quiz | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)

  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [quizzesLoading, setQuizzesLoading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [question, setQuestion] = useState<GameQuestion | null>(null)
  const [answered, setAnswered] = useState<AnswerCount | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  useEffect(() => {
    if (!storedToken) return
    let cancelled = false
    fetchMe(storedToken)
      .then((account) => {
        if (cancelled) return
        setHost(account)
        setAuthStatus('authenticated')
        setAuthError(null)
      })
      .catch((validationError) => {
        if (cancelled) return
        setHost(null)
        setToken('')
        setAuthStatus('anonymous')
        setAuthError(describeApiError(validationError))
      })
    return () => {
      cancelled = true
    }
  }, [storedToken])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !token) return
    void reloadQuizzes(token)
  }, [authStatus, token])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !token) return

    const socket = createSocket({ token })
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
      setOpeningId(null)
      setError(null)
      setPhase('lobby')
    })
    socket.on('lobby:update', ({ playerCount: count }) => setPlayerCount(count))
    socket.on('game:question', (payload) => {
      setQuestion(payload)
      setAnswered(null)
      setPhase('live')
    })
    socket.on('game:answer_count', (payload) => setAnswered(payload))
    socket.on('game:ended', (payload) => {
      if (!isHostGameEnded(payload)) return
      setLeaderboard(payload.leaderboard)
      setPhase('ended')
    })
    socket.on('error', (payload) => {
      setOpeningId(null)
      if (payload.code === 'AUTH_REQUIRED') {
        resetSession(payload.message)
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
  }, [authStatus, token])

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

  const joinUrl = `${window.location.origin}/play?code=${code}`

  async function reloadQuizzes(authToken: string) {
    setQuizzesLoading(true)
    try {
      setQuizzes(await fetchQuizzes(authToken))
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

  async function handleAuth(mode: AuthMode, email: string, password: string) {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const result = mode === 'signup' ? await signup(email, password) : await login(email, password)
      saveHostToken(result.token)
      setToken(result.token)
      setHost(result.host)
      setAuthStatus('authenticated')
      setError(null)
    } catch (authFailure) {
      setAuthError(describeApiError(authFailure))
    } finally {
      setAuthBusy(false)
    }
  }

  function resetSession(message: string | null = null) {
    clearHostToken()
    setToken('')
    setHost(null)
    setAuthStatus('anonymous')
    setAuthError(message)
    setAuthBusy(false)
    setPhase('idle')
    setCode('')
    setPlayerCount(0)
    setQuestion(null)
    setAnswered(null)
    setLeaderboard([])
    setQuizzes([])
    setQuizzesLoading(false)
    setBuilderOpen(false)
    setBuilderQuiz(null)
    setTab('quizzes')
    setOpeningId(null)
    setDeletingId(null)
    setError(null)
    setCopied(null)
  }

  function handleLogout() {
    if (
      phase !== 'idle' &&
      !window.confirm('Log out? The game keeps running on the server without you.')
    ) {
      return
    }
    resetSession()
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
    if (!socketRef.current || !code) return
    setError(null)
    socketRef.current.emit('host:start', { code })
  }

  function newRoom() {
    setPhase('idle')
    setCode('')
    setPlayerCount(0)
    setQuestion(null)
    setAnswered(null)
    setLeaderboard([])
    setError(null)
    setOpeningId(null)
    setTab('quizzes')
    if (token) void reloadQuizzes(token)
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
    if (token) void reloadQuizzes(token)
  }

  async function handleDelete(quiz: Quiz) {
    if (!token) return
    if (!window.confirm(`Delete “${quiz.title}”? This cannot be undone.`)) return
    setDeletingId(quiz.id)
    setError(null)
    try {
      await deleteQuiz(token, quiz.id)
      setQuizzes((current) => current.filter((item) => item.id !== quiz.id))
    } catch (deleteFailure) {
      setError(describeApiError(deleteFailure))
    } finally {
      setDeletingId(null)
    }
  }

  function renderContent() {
    if (authStatus === 'checking') return <CheckingView />
    if (authStatus === 'anonymous' || !token) {
      return (
        <AuthView
          busy={authBusy}
          error={authError}
          onDismissError={() => setAuthError(null)}
          onSubmit={(mode, email, password) => void handleAuth(mode, email, password)}
        />
      )
    }

    if (phase === 'lobby') {
      return (
        <LobbyView
          code={code}
          playerCount={playerCount}
          joinUrl={joinUrl}
          copied={copied}
          onCopy={copyText}
          onStart={startGame}
          online={connection === 'connected'}
        />
      )
    }

    if (phase === 'live' && question) {
      return (
        <LiveView
          question={question}
          answered={answered}
          playerCount={playerCount}
          code={code}
          seconds={countdown.seconds}
          progress={countdown.progress}
          ended={countdown.ended}
        />
      )
    }

    if (phase === 'ended') {
      return <EndedView code={code} leaderboard={leaderboard} onNewRoom={newRoom} />
    }

    if (builderOpen) {
      return (
        <QuizBuilder
          key={builderQuiz?.id ?? 'new-quiz'}
          token={token}
          quiz={builderQuiz}
          onSaved={handleQuizSaved}
          onCancel={closeBuilder}
        />
      )
    }

    return (
      <div className="mx-auto w-full max-w-4xl py-6 animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Host console</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Run the room.</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-mist-400">
              Build a quiz, open a room, and share the code. Questions advance on their own once
              you start.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => setTab('quizzes')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                tab === 'quizzes'
                  ? 'bg-acid-400 text-night-950'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              <ListChecks className="size-4" />
              Saved quizzes
            </button>
            <button
              type="button"
              onClick={() => setTab('results')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                tab === 'results'
                  ? 'bg-acid-400 text-night-950'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              <Trophy className="size-4" />
              Past results
            </button>
          </div>
        </div>

        <div className="mt-8">
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
            <PastResults token={token} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-svh flex-col">
      <Backdrop />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.14em] text-mist-400 uppercase sm:inline">
            Host
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {code && phase !== 'idle' && (
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-300 tabular-nums sm:inline">
              Room {code}
            </span>
          )}
          {authStatus === 'authenticated' && (
            <>
              {host && (
                <span className="hidden max-w-[15rem] truncate text-xs text-mist-500 lg:inline">
                  {host.email}
                </span>
              )}
              <ConnectionPill state={connection} />
              <button
                type="button"
                onClick={handleLogout}
                className="btn-ghost px-3 py-2 text-sm"
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-10 sm:px-8">
        {authStatus === 'authenticated' && (
          <div className="mx-auto w-full max-w-4xl">
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
            {connection === 'offline' && phase !== 'idle' && (
              <div className="mb-5 flex items-center gap-3 rounded-2xl border border-[#ffd08a]/25 bg-[#ffd08a]/10 px-4 py-3 text-sm text-[#ffe1b0]">
                <WifiOff className="size-4 shrink-0" />
                Connection lost — reconnecting. The game keeps running on the server.
              </div>
            )}
          </div>
        )}

        {renderContent()}
      </main>

      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t border-white/8 px-5 py-4 text-xs text-mist-500 sm:px-8">
        <Link to="/" className="inline-flex items-center gap-1.5 transition-colors hover:text-mist-300">
          <ArrowLeft className="size-3.5" />
          Back to home
        </Link>
        <span>Host console · the host never plays</span>
      </footer>
    </div>
  )
}

function CheckingView() {
  return (
    <div className="my-auto py-20 text-center animate-rise">
      <div className="relative mx-auto grid size-16 place-items-center">
        <span className="absolute inset-0 rounded-full bg-acid-400/15 blur-xl" />
        <span className="grid size-16 place-items-center rounded-full border border-white/10 bg-night-850">
          <Loader2 className="size-6 animate-spin text-acid-300" />
        </span>
      </div>
      <p className="mt-5 text-sm text-mist-400">Checking your host session…</p>
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
  online,
}: {
  code: string
  playerCount: number
  joinUrl: string
  copied: 'code' | 'link' | null
  onCopy: (value: string, kind: 'code' | 'link') => void
  onStart: () => void
  online: boolean
}) {
  const digits = code.padStart(6, '0').split('')

  return (
    <div className="mx-auto my-auto w-full max-w-2xl py-6 animate-rise">
      <div className="text-center">
        <p className="eyebrow">Room code</p>
        <div className="mt-3 flex justify-center gap-1.5 sm:gap-2.5">
          {digits.map((digit, index) => (
            <span
              key={index}
              className="grid h-16 w-11 place-items-center rounded-2xl border border-white/12 bg-white/[0.05] text-4xl font-bold tabular-nums text-mist-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:h-20 sm:w-16 sm:text-5xl"
            >
              {digit}
            </span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onCopy(code, 'code')}
            className="btn-ghost px-4 py-2.5 text-sm"
          >
            {copied === 'code' ? (
              <Check className="size-4 text-acid-300" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
          <button
            type="button"
            onClick={() => onCopy(joinUrl, 'link')}
            className="btn-ghost px-4 py-2.5 text-sm"
          >
            {copied === 'link' ? (
              <Check className="size-4 text-acid-300" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied === 'link' ? 'Copied' : 'Copy join link'}
          </button>
        </div>
        <p className="mt-3 truncate text-xs text-mist-500 sm:text-sm">Players open {joinUrl}</p>
      </div>

      <div className="panel mt-9 p-6 sm:p-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">Players in the room</p>
            <p className="mt-1 text-6xl leading-none font-bold tabular-nums text-acid-300">
              {playerCount}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-mist-400">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-acid-400 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-acid-400" />
            </span>
            Lobby open
          </div>
        </div>

        <div className="mt-7 border-t border-white/8 pt-6">
          <p className="text-sm leading-relaxed text-mist-400">
            Players join at <span className="text-mist-200">{joinUrl}</span>. The first question
            goes out to everyone at the same moment.
          </p>
          <button type="button" onClick={onStart} disabled={!online} className="btn-primary mt-5 w-full">
            <Play className="size-4" fill="currentColor" />
            Start game
          </button>
          {playerCount === 0 && (
            <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-mist-500">
              <Users className="size-3.5" />
              Waiting for the first player to join.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function LiveView({
  question,
  answered,
  playerCount,
  code,
  seconds,
  progress,
  ended,
}: {
  question: GameQuestion
  answered: AnswerCount | null
  playerCount: number
  code: string
  seconds: number
  progress: number
  ended: boolean
}) {
  const answeredCount = answered?.index === question.index ? answered.answered : 0
  const total = answered?.index === question.index ? answered.total : playerCount

  return (
    <div className="mx-auto w-full max-w-4xl py-3 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-300 tabular-nums">
            Question {question.index + 1} of {question.total}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-acid-400/25 bg-acid-400/10 px-3 py-1.5 text-xs font-semibold text-acid-300 tabular-nums">
            <Users className="size-3.5" />
            {answeredCount} / {total} answered
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-400 tabular-nums">
          Room {code}
        </span>
      </div>

      <div className="panel mt-4 p-6 sm:p-9">
        <TimerBar seconds={seconds} progress={progress} />
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-iris-400 transition-[width] duration-300"
            style={{ width: `${total > 0 ? Math.min(100, (answeredCount / total) * 100) : 0}%` }}
          />
        </div>

        <h1 className="mt-8 text-2xl leading-tight font-bold text-balance sm:text-4xl">
          {question.text}
        </h1>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {question.options.map((option, index) => (
            <div
              key={index}
              className="flex items-center gap-3.5 rounded-2xl border border-white/8 bg-night-900/55 px-4 py-4"
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${OPTION_ACCENTS[index % OPTION_ACCENTS.length]}`}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span className="text-base font-medium text-mist-100 sm:text-lg">{option}</span>
            </div>
          ))}
        </div>

        <p className="mt-7 border-t border-white/8 pt-5 text-sm text-mist-400">
          {ended
            ? 'Answers are locked — results are landing on player phones.'
            : 'Players can change their answer until the clock runs out.'}
        </p>
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
    <div className="mx-auto my-auto w-full max-w-2xl py-6 animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            Room {code} · {leaderboard.length} players
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">Final standings</h1>
        </div>
        <button type="button" onClick={onNewRoom} className="btn-ghost px-4 py-2.5 text-sm">
          <RotateCcw className="size-4" />
          New room
        </button>
      </div>

      <div className="panel mt-7 p-5 sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="eyebrow">Full leaderboard</p>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.14em] text-mist-400 uppercase">
            Host view
          </span>
        </div>
        <Leaderboard rows={leaderboard} emptyLabel="No players finished this game" />
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-mist-500">
        Players see their own rank and the top 5. This screen is the only place with the full
        leaderboard.
      </p>
    </div>
  )
}
