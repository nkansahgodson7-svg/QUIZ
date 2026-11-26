import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Clock,
  Crown,
  Loader2,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react'
import { Backdrop } from '../components/Backdrop'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { Logo } from '../components/Logo'
import { TimerRing } from '../components/Timer'
import { useCountdown } from '../hooks/useCountdown'
import {
  isPlayerGameEnded,
  type GameQuestion,
  type GameSocket,
  type JoinedPayload,
  type LeaderRow,
  type PlayerResult,
} from '../lib/contract'
import {
  clearStoredPlayer,
  loadStoredPlayer,
  saveStoredPlayer,
  type StoredPlayer,
} from '../lib/player-storage'
import { createSocket } from '../lib/socket'

type PlayerPhase = 'join' | 'joining' | 'lobby' | 'question' | 'reveal' | 'ended'

const OPTION_ACCENTS = [
  'bg-iris-500 text-white',
  'bg-aqua-400 text-night-950',
  'bg-coral-400 text-night-950',
  'bg-acid-400 text-night-950',
]

interface FinalState {
  rank: number
  score: number
  rows: LeaderRow[]
}

export function PlayerPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [initial] = useState(() => {
    const urlCode = (searchParams.get('code') ?? '').replace(/\D/g, '').slice(0, 6)
    // Shared invite links collect junk (?code=1-23456x, duplicate code params).
    // Canonicalize to /play?code=<six digits> so the address bar stays clean.
    const canonicalPath = `/play${urlCode ? `?code=${urlCode}` : ''}`
    const needsCanonical = `${window.location.pathname}${window.location.search}` !== canonicalPath
    const stored = loadStoredPlayer()
    if (stored && (!urlCode || urlCode === stored.code)) {
      return { stored, code: stored.code, canonicalPath, needsCanonical }
    }
    return { stored: null, code: urlCode, canonicalPath, needsCanonical }
  })

  const socketRef = useRef<GameSocket | null>(null)
  const questionRef = useRef<GameQuestion | null>(null)
  const codeRef = useRef(initial.code)
  const rejoinRef = useRef<{ code: string; playerToken: string } | null>(
    initial.stored
      ? { code: initial.stored.code, playerToken: initial.stored.playerToken }
      : null,
  )
  const pendingRejoin = useRef<StoredPlayer | null>(initial.stored)
  const storedNickname = useRef(initial.stored?.nickname ?? '')
  const joiningRef = useRef(false)

  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [phase, setPhase] = useState<PlayerPhase>(initial.stored ? 'joining' : 'join')
  const [code, setCode] = useState(initial.code)
  const [nickname, setNickname] = useState('')
  const [me, setMe] = useState<JoinedPayload | null>(null)
  const [question, setQuestion] = useState<GameQuestion | null>(null)
  const [selection, setSelection] = useState<{ index: number; choiceIndex: number } | null>(null)
  const [ineligibleIndex, setIneligibleIndex] = useState<number | null>(null)
  const [result, setResult] = useState<PlayerResult | null>(null)
  const [final, setFinal] = useState<FinalState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initial.needsCanonical) navigate(initial.canonicalPath, { replace: true })
  }, [initial.needsCanonical, initial.canonicalPath, navigate])

  useEffect(() => {
    const socket = createSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      setConnection('connected')
      const target = rejoinRef.current
      if (target) {
        joiningRef.current = true
        socket.emit('player:rejoin', {
          code: target.code,
          playerToken: target.playerToken,
        })
      }
    })
    socket.on('disconnect', () => setConnection('offline'))
    socket.on('connect_error', () => setConnection('offline'))

    socket.on('player:joined', (payload) => {
      const roomCode = rejoinRef.current?.code ?? codeRef.current
      codeRef.current = roomCode
      setCode(roomCode)
      setMe(payload)
      setNickname(payload.nickname)
      storedNickname.current = payload.nickname
      saveStoredPlayer({
        code: roomCode,
        nickname: payload.nickname,
        playerToken: payload.playerToken,
      })
      rejoinRef.current = { code: roomCode, playerToken: payload.playerToken }
      pendingRejoin.current = null
      joiningRef.current = false
      setError(null)
      setPhase('lobby')
    })

    socket.on('game:question', (payload) => {
      questionRef.current = payload
      setQuestion(payload)
      setSelection(
        payload.myChoiceIndex == null
          ? null
          : { index: payload.index, choiceIndex: payload.myChoiceIndex },
      )
      setIneligibleIndex(null)
      setResult(null)
      setPhase('question')
    })

    socket.on('question:result', (payload) => {
      setResult(payload)
      setPhase('reveal')
    })

    socket.on('game:ended', (payload) => {
      if (!isPlayerGameEnded(payload)) return
      setFinal({
        rank: payload.yourRank,
        score: payload.yourScore,
        rows: payload.top5,
      })
      setPhase('ended')
    })

    socket.on('error', (payload) => {
      if (payload.code === 'NOT_ELIGIBLE') {
        // The server rejected an optimistic answer from a late joiner. Drop the
        // selection and lock this question so the UI never claims "Locked in".
        setSelection(null)
        setIneligibleIndex(questionRef.current?.index ?? null)
      } else {
        setError(payload.message)
      }
      if (joiningRef.current) {
        joiningRef.current = false
        if (pendingRejoin.current) {
          pendingRejoin.current = null
          rejoinRef.current = null
          clearStoredPlayer()
          if (storedNickname.current) setNickname(storedNickname.current)
        }
        setPhase('join')
      }
    })

    socket.connect()
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const countdown = useCountdown(
    phase === 'question' ? (question?.startsAt ?? null) : null,
    phase === 'question' ? (question?.durationMs ?? null) : null,
  )

  const selectedChoice =
    selection && question && selection.index === question.index ? selection.choiceIndex : null
  const ineligible =
    phase === 'question' && question != null && ineligibleIndex === question.index
  const canAnswer =
    phase === 'question' &&
    countdown.started &&
    !countdown.ended &&
    connection === 'connected' &&
    !ineligible

  function joinGame(event: React.FormEvent) {
    event.preventDefault()
    const cleanCode = code.replace(/\D/g, '').slice(0, 6)
    const cleanNickname = nickname.trim()

    if (cleanCode.length !== 6) {
      setError('Enter the six-digit room code.')
      return
    }
    if (!cleanNickname) {
      setError('Pick a nickname so the room knows who you are.')
      return
    }
    if (!socketRef.current || connection !== 'connected') {
      setError('Still connecting to the game server. Try again in a moment.')
      return
    }

    codeRef.current = cleanCode
    rejoinRef.current = null
    pendingRejoin.current = null
    joiningRef.current = true
    setError(null)
    setPhase('joining')
    socketRef.current.emit('player:join', { code: cleanCode, nickname: cleanNickname })
  }

  function chooseAnswer(choiceIndex: number) {
    if (!question || !canAnswer) return
    setSelection({ index: question.index, choiceIndex })
    socketRef.current?.emit('player:answer', {
      code: codeRef.current,
      questionIndex: question.index,
      choiceIndex,
    })
  }

  function cancelJoining() {
    joiningRef.current = false
    pendingRejoin.current = null
    rejoinRef.current = null
    clearStoredPlayer()
    setError(null)
    setPhase('join')
  }

  function playAgain() {
    clearStoredPlayer()
    rejoinRef.current = null
    pendingRejoin.current = null
    codeRef.current = ''
    setMe(null)
    setCode('')
    setNickname('')
    setQuestion(null)
    setSelection(null)
    setIneligibleIndex(null)
    setResult(null)
    setFinal(null)
    setError(null)
    navigate('/play', { replace: true })
    setPhase('join')
  }

  const showOfflineBanner =
    connection === 'offline' && phase !== 'join' && phase !== 'joining'

  return (
    <div className="relative flex min-h-svh flex-col">
      <Backdrop />

      <header className="mx-auto flex w-full max-w-md items-center justify-between px-5 pt-5 pb-2">
        <div className="flex items-center gap-2.5">
          <Logo compact />
          {code && phase !== 'join' && phase !== 'joining' && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.7rem] font-medium text-mist-400 tabular-nums">
              Room {code}
            </span>
          )}
        </div>
        <ConnectionPill state={connection} />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {showOfflineBanner && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-[#ffd08a]/25 bg-[#ffd08a]/10 px-4 py-2.5 text-xs text-[#ffe1b0]">
            <WifiOff className="size-3.5 shrink-0" />
            Reconnecting — your score is safe.
          </div>
        )}

        {phase !== 'join' && phase !== 'joining' && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {phase === 'join' ? (
          <JoinView
            code={code}
            nickname={nickname}
            error={error}
            online={connection === 'connected'}
            onCodeChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            onNicknameChange={setNickname}
            onDismissError={() => setError(null)}
            onSubmit={joinGame}
          />
        ) : phase === 'joining' ? (
          <JoiningView
            code={code}
            online={connection === 'connected'}
            error={error}
            onCancel={cancelJoining}
          />
        ) : phase === 'lobby' ? (
          <LobbyView nickname={me?.nickname ?? nickname} code={code} />
        ) : phase === 'question' && question ? (
          <QuestionView
            question={question}
            seconds={countdown.seconds}
            progress={countdown.progress}
            selectedChoice={selectedChoice}
            started={countdown.started}
            ended={countdown.ended}
            ineligible={ineligible}
            online={connection === 'connected'}
            onChoose={chooseAnswer}
          />
        ) : phase === 'reveal' && result ? (
          <RevealView
            question={question}
            result={result}
            selectedChoice={selectedChoice}
            nickname={me?.nickname ?? nickname}
          />
        ) : phase === 'ended' && final ? (
          <FinalView
            final={final}
            nickname={me?.nickname ?? nickname}
            onPlayAgain={playAgain}
          />
        ) : null}
      </main>
    </div>
  )
}

function JoinView({
  code,
  nickname,
  error,
  online,
  onCodeChange,
  onNicknameChange,
  onDismissError,
  onSubmit,
}: {
  code: string
  nickname: string
  error: string | null
  online: boolean
  onCodeChange: (value: string) => void
  onNicknameChange: (value: string) => void
  onDismissError: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <div className="my-auto py-6 animate-rise">
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-mist-300">
        <Smartphone className="size-3.5 text-iris-400" />
        Player
      </span>
      <h1 className="mt-4 text-[2.7rem] leading-[1.02] font-bold tracking-tight">
        Jump into
        <br />
        the quiz.
      </h1>
      <p className="mt-3 text-base leading-relaxed text-mist-400">
        Enter the code on the big screen, pick a nickname, and get your phone ready.
      </p>

      <div className="mt-7">
        <ErrorBanner message={error} onDismiss={onDismissError} />
        <form onSubmit={onSubmit} className="panel p-5 sm:p-6">
          <label htmlFor="room-code" className="text-sm font-medium text-mist-200">
            Room code
          </label>
          <input
            id="room-code"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            aria-label="Six digit room code"
            className="field mt-2 text-center text-3xl font-bold tracking-[0.32em] tabular-nums placeholder:text-mist-500/45"
          />

          <label htmlFor="nickname" className="mt-5 block text-sm font-medium text-mist-200">
            Nickname
          </label>
          <input
            id="nickname"
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="e.g. Kwame"
            className="field mt-2"
          />
          <p className="mt-2 text-xs text-mist-500">
            If someone beat you to it, the room adds a number.
          </p>

          <button type="submit" disabled={!online} className="btn-primary mt-5 w-full">
            Join room
            <ArrowRight className="size-4" />
          </button>
          {!online && (
            <p className="mt-3 text-center text-xs text-mist-500">
              Connecting to the game server…
            </p>
          )}
        </form>
      </div>

      <p className="mt-4 px-2 text-center text-xs leading-relaxed text-mist-500">
        No account needed. This browser remembers your player token so you can rejoin if you drop.
      </p>
    </div>
  )
}

function JoiningView({
  code,
  online,
  error,
  onCancel,
}: {
  code: string
  online: boolean
  error: string | null
  onCancel: () => void
}) {
  return (
    <div className="my-auto py-10 text-center animate-rise">
      <div className="relative mx-auto grid size-20 place-items-center">
        <span className="absolute inset-0 rounded-full bg-acid-400/15 blur-xl" />
        <span className="grid size-16 place-items-center rounded-full border border-white/10 bg-night-850">
          {online ? (
            <Loader2 className="size-6 animate-spin text-acid-300" />
          ) : (
            <WifiOff className="size-6 text-coral-400" />
          )}
        </span>
      </div>
      <h1 className="mt-6 text-2xl font-bold">
        {online ? 'Getting you in…' : 'Can’t reach the server'}
      </h1>
      <p className="mt-2 text-sm text-mist-400">
        {code ? `Room ${code}` : 'Hold tight'} · this usually takes a second.
      </p>
      {error && <p className="mt-4 text-sm text-coral-400">{error}</p>}
      <button type="button" onClick={onCancel} className="btn-ghost mt-7 px-4 py-2.5 text-sm">
        <ChevronLeft className="size-4" />
        Back to join
      </button>
    </div>
  )
}

function LobbyView({ nickname, code }: { nickname: string; code: string }) {
  return (
    <div className="my-auto py-8 text-center animate-rise">
      <div className="relative mx-auto grid size-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-acid-400/10" />
        <span className="absolute inset-2 rounded-full bg-acid-400/10" />
        <span className="relative grid size-16 place-items-center rounded-full bg-acid-400 text-night-950 shadow-[0_0_40px_-6px_rgba(211,251,110,0.8)]">
          <Check className="size-7" strokeWidth={3} />
        </span>
      </div>

      <p className="mt-7 eyebrow">You&apos;re in</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight break-words">{nickname}</h1>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm text-mist-400">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 tabular-nums">
          Room {code}
        </span>
      </div>

      <div className="panel mt-8 px-6 py-7">
        <div className="flex items-center justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 animate-shimmer rounded-full bg-acid-400"
              style={{ animationDelay: `${i * 180}ms` }}
            />
          ))}
        </div>
        <p className="mt-4 font-medium text-mist-100">Waiting for the host to start</p>
        <p className="mt-1.5 text-sm leading-relaxed text-mist-400">
          Keep this tab open. The first question lands here with everyone else&apos;s.
        </p>
      </div>
    </div>
  )
}

function QuestionView({
  question,
  seconds,
  progress,
  selectedChoice,
  started,
  ended,
  ineligible,
  online,
  onChoose,
}: {
  question: GameQuestion
  seconds: number
  progress: number
  selectedChoice: number | null
  started: boolean
  ended: boolean
  ineligible: boolean
  online: boolean
  onChoose: (choiceIndex: number) => void
}) {
  const locked = !started || ended || !online || ineligible

  return (
    <div className="flex flex-1 flex-col animate-rise">
      <div className="flex items-start justify-between gap-4 pt-1">
        <div>
          <p className="eyebrow">
            Question {question.index + 1} of {question.total}
          </p>
          <p className="mt-1.5 text-sm text-mist-400">
            {question.type === 'true_false' ? 'True or false' : 'Choose one answer'}
          </p>
        </div>
        <TimerRing seconds={seconds} progress={progress} size="lg" />
      </div>

      <div className="mt-4 flex gap-1.5" aria-hidden>
        {Array.from({ length: question.total }).map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < question.index
                ? 'bg-acid-400/55'
                : i === question.index
                  ? 'bg-acid-400'
                  : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      <h1 className="mt-7 text-[1.7rem] leading-[1.15] font-bold tracking-tight text-balance sm:text-3xl">
        {question.text}
      </h1>

      <div className="mt-6 flex flex-col gap-3">
        {question.options.map((option, index) => {
          const selected = selectedChoice === index
          return (
            <button
              key={index}
              type="button"
              onClick={() => onChoose(index)}
              disabled={locked}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3.5 rounded-2xl border px-4 py-4 text-left transition-[transform,border-color,background-color] duration-150 active:scale-[0.99] disabled:cursor-not-allowed ${
                selected
                  ? 'border-acid-400 bg-acid-400/12 shadow-[0_0_0_1px_rgba(211,251,110,0.25)]'
                  : 'border-white/10 bg-white/[0.04] enabled:hover:border-white/25 enabled:hover:bg-white/[0.06]'
              } ${locked && !selected ? 'opacity-55' : ''}`}
            >
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${OPTION_ACCENTS[index % OPTION_ACCENTS.length]}`}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 flex-1 text-[1.05rem] leading-snug font-medium">
                {option}
              </span>
              {selected && <Check className="size-5 shrink-0 text-acid-300" strokeWidth={3} />}
            </button>
          )
        })}
      </div>

      <div className="mt-auto pt-6">
        <p
          className={`rounded-2xl px-4 py-3 text-center text-sm ${
            ineligible
              ? 'bg-iris-500/10 text-iris-400'
              : ended
                ? 'bg-coral-400/10 text-[#ffc4b8]'
                : selectedChoice != null
                  ? 'bg-acid-400/10 text-acid-200'
                  : 'bg-white/[0.04] text-mist-400'
          }`}
          aria-live="polite"
        >
          {ineligible
            ? 'You joined during this question — you can start scoring on the next one.'
            : !started
              ? 'Get ready — answers open when the timer starts.'
              : ended
                ? 'Time is up — waiting for the results…'
                : selectedChoice != null
                  ? 'Locked in. Tap another option to change it.'
                  : 'Tap your answer. You can change it until time runs out.'}
        </p>
      </div>
    </div>
  )
}

function RevealView({
  question,
  result,
  selectedChoice,
  nickname,
}: {
  question: GameQuestion | null
  result: PlayerResult
  selectedChoice: number | null
  nickname: string
}) {
  const picked = selectedChoice != null
  const correct = picked && selectedChoice === result.correctIndex
  const heading = result.points > 0 ? 'Correct!' : picked ? 'Not quite' : 'Time’s up'

  return (
    <div className="flex flex-1 flex-col py-2 animate-rise">
      <p className="eyebrow">Question {(question?.index ?? result.index) + 1} · results</p>
      <div className="mt-1 flex items-end justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">{heading}</h1>
        {correct ? (
          <span className="grid size-10 place-items-center rounded-full bg-acid-400 text-night-950">
            <Check className="size-5" strokeWidth={3} />
          </span>
        ) : (
          <span className="grid size-10 place-items-center rounded-full bg-white/8 text-mist-300">
            <X className="size-5" strokeWidth={3} />
          </span>
        )}
      </div>

      <div className="panel mt-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Points earned</p>
            <p
              key={result.points}
              className={`mt-1 animate-pop text-5xl leading-none font-bold tabular-nums ${
                result.points > 0 ? 'text-acid-300' : 'text-coral-400'
              }`}
            >
              +{result.points}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-5 text-right">
            <div>
              <p className="eyebrow">Total</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{result.totalScore}</p>
            </div>
            <div>
              <p className="eyebrow">Rank</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-acid-300">
                #{result.rank}
              </p>
            </div>
          </div>
        </div>
      </div>

      {question && (
        <>
          <h2 className="mt-6 text-xl leading-snug font-semibold text-balance">
            {question.text}
          </h2>

          <div className="mt-4 flex flex-col gap-2.5">
            {question.options.map((option, index) => {
              const isCorrect = index === result.correctIndex
              const isWrongPick = selectedChoice === index && !isCorrect
              return (
                <div
                  key={index}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                    isCorrect
                      ? 'border-acid-400/60 bg-acid-400/12'
                      : isWrongPick
                        ? 'border-coral-400/50 bg-coral-400/10'
                        : 'border-white/8 bg-white/[0.025] opacity-65'
                  }`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                      isCorrect
                        ? 'bg-acid-400 text-night-950'
                        : isWrongPick
                          ? 'bg-coral-400 text-night-950'
                          : `${OPTION_ACCENTS[index % OPTION_ACCENTS.length]} opacity-75`
                    }`}
                  >
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{option}</span>
                  {isCorrect && (
                    <Check className="size-4 shrink-0 text-acid-300" strokeWidth={3} />
                  )}
                  {isWrongPick && (
                    <X className="size-4 shrink-0 text-coral-400" strokeWidth={3} />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="mt-6">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="eyebrow">Top 5 right now</p>
          <span className="flex items-center gap-1.5 text-[0.65rem] font-medium tracking-[0.14em] text-mist-500 uppercase">
            <span className="size-1.5 animate-shimmer rounded-full bg-acid-400" />
            Next up soon
          </span>
        </div>
        <Leaderboard rows={result.top5} highlight={nickname} limit={5} />
      </div>
    </div>
  )
}

function FinalView({
  final,
  nickname,
  onPlayAgain,
}: {
  final: FinalState
  nickname: string
  onPlayAgain: () => void
}) {
  const won = final.rank === 1

  return (
    <div className="flex flex-1 flex-col justify-center py-6 animate-rise">
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-acid-400/12 text-acid-300">
          {won ? <Crown className="size-7" /> : <Clock className="size-7" />}
        </span>
        <p className="mt-5 eyebrow">Final result</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-balance">
          {won ? 'You took the crown.' : 'That’s a wrap.'}
        </h1>
      </div>

      <div className="panel mt-6 p-6 text-center">
        <p className="eyebrow">Your rank</p>
        <p className="mt-1 text-7xl leading-none font-bold tabular-nums text-acid-300">
          #{final.rank}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-mist-400">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-semibold text-mist-200 tabular-nums">
            {final.score.toLocaleString()} pts
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            {nickname}
          </span>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2.5 eyebrow">Top 5</p>
        <Leaderboard rows={final.rows} highlight={nickname} limit={5} />
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <button type="button" onClick={onPlayAgain} className="btn-primary w-full">
          Join another game
          <ArrowRight className="size-4" />
        </button>
        <Link
          to="/"
          className="py-2 text-center text-sm text-mist-400 transition-colors hover:text-mist-200"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
