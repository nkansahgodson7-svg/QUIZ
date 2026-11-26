import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  ListChecks,
  Loader2,
  LogOut,
  Play,
  RotateCcw,
  Trophy,
  WifiOff,
} from 'lucide-react'
import { AuthView, type AuthMode } from '../components/host/AuthView'
import { LiveConsole } from '../components/host/LiveConsole'
import { PastResults } from '../components/host/PastResults'
import { QuizBuilder } from '../components/host/QuizBuilder'
import { SavedQuizzes } from '../components/host/SavedQuizzes'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { Logo } from '../components/Logo'
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
  type HostLiveState,
  type LeaderRow,
} from '../lib/contract'
import { clearHostToken, loadHostToken, saveHostToken } from '../lib/host-storage'
import { createSocket } from '../lib/socket'

type AuthStatus = 'checking' | 'anonymous' | 'authenticated'
type HostPhase = 'idle' | 'lobby' | 'live' | 'ended'
type DashboardTab = 'quizzes' | 'results'

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
  const [liveState, setLiveState] = useState<HostLiveState | null>(null)
  const [standings, setStandings] = useState<LeaderRow[]>([])
  const [questionEnded, setQuestionEnded] = useState(false)
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

  const hasRoomCode = /^\d{6}$/.test(code)
  const joinUrl = hasRoomCode ? `${window.location.origin}/play?code=${code}` : null

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
    setLiveState(null)
    setStandings([])
    setQuestionEnded(false)
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

  function newRoom() {
    setPhase('idle')
    setCode('')
    setPlayerCount(0)
    setQuestion(null)
    setAnswered(null)
    setLeaderboard([])
    setLiveState(null)
    setStandings([])
    setQuestionEnded(false)
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
      <div className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your quizzes</h1>
            <p className="mt-1 text-sm text-ink-2">
              Open a room, edit a quiz, or check how the last game went.
            </p>
          </div>
          <div className="flex rounded-xl border border-line bg-card p-1">
            <button
              type="button"
              onClick={() => setTab('quizzes')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                tab === 'quizzes' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <ListChecks className="size-4" />
              Quizzes
            </button>
            <button
              type="button"
              onClick={() => setTab('results')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
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
            <PastResults token={token} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
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
          {authStatus === 'authenticated' && (
            <div className="flex items-center gap-2">
              {host && (
                <span className="hidden max-w-[14rem] truncate text-xs text-ink-3 lg:inline">
                  {host.email}
                </span>
              )}
              <ConnectionPill state={connection} />
              <button type="button" onClick={handleLogout} className="btn-quiet px-2.5 py-2 text-sm">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8">
        {authStatus === 'authenticated' && (
          <>
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
            {connection === 'offline' && phase !== 'idle' && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-sm font-semibold text-warn">
                <WifiOff className="size-4 shrink-0" />
                Connection lost — reconnecting. The game keeps running on the server.
              </div>
            )}
          </>
        )}

        {renderContent()}
      </main>
    </div>
  )
}

function CheckingView() {
  return (
    <div className="my-auto py-20 text-center">
      <Loader2 className="mx-auto size-5 animate-spin text-ink-3" />
      <p className="mt-3 text-sm text-ink-2">Checking your host session…</p>
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
  joinUrl: string | null
  copied: 'code' | 'link' | null
  onCopy: (value: string, kind: 'code' | 'link') => void
  onStart: () => void
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
              className="grid h-[4.5rem] w-12 place-items-center rounded-xl border-2 border-ink bg-card text-4xl font-extrabold tabular-nums sm:h-24 sm:w-16 sm:text-5xl"
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

      <div className="card mt-6 p-5">
        <p className="text-sm font-bold text-ink">Players join at</p>
        <p className="mt-1 truncate text-base font-semibold text-cobalt">
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

      <div className="mt-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-bold text-ink-2">Players in the room</p>
          <p className="mt-1 text-6xl leading-none font-extrabold tabular-nums">{playerCount}</p>
          {playerCount === 0 && (
            <p className="mt-2 text-sm text-ink-3">Waiting for the first player to join.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={!online}
          className="btn-primary px-6 py-4 text-base"
        >
          <Play className="size-4" fill="currentColor" />
          Start game
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
