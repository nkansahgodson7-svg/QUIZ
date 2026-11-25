import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Play,
  Radio,
  RotateCcw,
  Users,
  WifiOff,
} from 'lucide-react'
import { Backdrop } from '../components/Backdrop'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { Logo } from '../components/Logo'
import { TimerBar } from '../components/Timer'
import { useCountdown } from '../hooks/useCountdown'
import {
  normalizeLeaderboard,
  type AnswerCount,
  type GameQuestion,
  type GameSocket,
  type LeaderRow,
} from '../lib/contract'
import { createSocket } from '../lib/socket'

type HostPhase = 'setup' | 'creating' | 'lobby' | 'live' | 'ended'

const OPTION_ACCENTS = [
  'bg-iris-500 text-white',
  'bg-aqua-400 text-night-950',
  'bg-coral-400 text-night-950',
  'bg-acid-400 text-night-950',
]

export function HostPage() {
  const socketRef = useRef<GameSocket | null>(null)
  const copyTimer = useRef<number | null>(null)

  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [phase, setPhase] = useState<HostPhase>('setup')
  const [quizId, setQuizId] = useState('demo-quiz')
  const [code, setCode] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [question, setQuestion] = useState<GameQuestion | null>(null)
  const [answered, setAnswered] = useState<AnswerCount | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  useEffect(() => {
    const socket = createSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      setConnection('connected')
      setError(null)
    })
    socket.on('disconnect', () => setConnection('offline'))
    socket.on('connect_error', () => setConnection('offline'))

    socket.on('room:created', ({ code: roomCode }) => {
      setCode(roomCode)
      setPlayerCount(0)
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
      setLeaderboard(normalizeLeaderboard(payload.leaderboard ?? payload.top5))
      setPhase('ended')
    })
    socket.on('error', (payload) => {
      setError(payload.message)
      setPhase((current) => (current === 'creating' ? 'setup' : current))
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

  const joinUrl = `${window.location.origin}/play?code=${code}`

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

  function createRoom(event: React.FormEvent) {
    event.preventDefault()
    if (!socketRef.current) return
    setError(null)
    setPhase('creating')
    socketRef.current.emit('host:create_room', { quizId: quizId.trim() || 'demo-quiz' })
  }

  function startGame() {
    if (!socketRef.current || !code) return
    setError(null)
    socketRef.current.emit('host:start', { code })
  }

  function newRoom() {
    setPhase('setup')
    setCode('')
    setPlayerCount(0)
    setQuestion(null)
    setAnswered(null)
    setLeaderboard([])
    setError(null)
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
          {code && phase !== 'setup' && phase !== 'creating' && (
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-300 tabular-nums sm:inline">
              Room {code}
            </span>
          )}
          <ConnectionPill state={connection} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-10 sm:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
          {connection === 'offline' && phase !== 'setup' && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-[#ffd08a]/25 bg-[#ffd08a]/10 px-4 py-3 text-sm text-[#ffe1b0]">
              <WifiOff className="size-4 shrink-0" />
              Connection lost — reconnecting. The game keeps running on the server.
            </div>
          )}
        </div>

        {phase === 'setup' || phase === 'creating' ? (
          <SetupView
            quizId={quizId}
            onQuizIdChange={setQuizId}
            onSubmit={createRoom}
            creating={phase === 'creating'}
            online={connection === 'connected'}
          />
        ) : phase === 'lobby' ? (
          <LobbyView
            code={code}
            playerCount={playerCount}
            joinUrl={joinUrl}
            copied={copied}
            onCopy={copyText}
            onStart={startGame}
            online={connection === 'connected'}
          />
        ) : phase === 'live' && question ? (
          <LiveView
            question={question}
            answered={answered}
            playerCount={playerCount}
            code={code}
            seconds={countdown.seconds}
            progress={countdown.progress}
            ended={countdown.ended}
          />
        ) : phase === 'ended' ? (
          <EndedView
            code={code}
            playerCount={playerCount}
            leaderboard={leaderboard}
            onNewRoom={newRoom}
          />
        ) : null}
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

function SetupView({
  quizId,
  onQuizIdChange,
  onSubmit,
  creating,
  online,
}: {
  quizId: string
  onQuizIdChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  creating: boolean
  online: boolean
}) {
  return (
    <div className="mx-auto my-auto w-full max-w-lg py-8 animate-rise">
      <p className="eyebrow">Host console</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        Open a room.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-mist-300">
        Pick a saved quiz, share the six-digit code, and run the game from this screen. Questions
        advance on their own once you start.
      </p>

      <form onSubmit={onSubmit} className="panel mt-8 p-6 sm:p-7">
        <label htmlFor="quiz-id" className="text-sm font-medium text-mist-200">
          Saved quiz
        </label>
        <input
          id="quiz-id"
          value={quizId}
          onChange={(event) => onQuizIdChange(event.target.value)}
          placeholder="demo-quiz"
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          className="field mt-2"
        />
        <p className="mt-2.5 text-xs leading-relaxed text-mist-500">
          The mock server serves <code className="rounded bg-white/8 px-1.5 py-0.5 text-mist-300">demo-quiz</code>.
          Use the real server&apos;s quiz ID when it lands.
        </p>

        <button
          type="submit"
          disabled={creating || !online}
          className="btn-primary mt-6 w-full"
        >
          {creating ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating room…
            </>
          ) : (
            <>
              <Radio className="size-4" />
              Create room
            </>
          )}
        </button>
        {!online && (
          <p className="mt-3 text-center text-xs text-mist-500">
            Waiting for the game server before you can open a room.
          </p>
        )}
      </form>
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
  playerCount,
  leaderboard,
  onNewRoom,
}: {
  code: string
  playerCount: number
  leaderboard: LeaderRow[]
  onNewRoom: () => void
}) {
  return (
    <div className="mx-auto my-auto w-full max-w-2xl py-6 animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Room {code} · {playerCount} players</p>
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
