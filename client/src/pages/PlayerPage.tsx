import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  Clock,
  Crown,
  Loader2,
  WifiOff,
  X,
} from 'lucide-react'
import { ChoiceShape, choiceColor } from '../components/ChoiceShape'
import { ConnectionPill, type ConnectionState } from '../components/ConnectionPill'
import { ErrorBanner } from '../components/ErrorBanner'
import { Leaderboard } from '../components/Leaderboard'
import { PulseDot } from '../components/Loading'
import { Logo } from '../components/Logo'
import { TimerBar } from '../components/Timer'
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

  const inGameplay = (phase === 'question' || phase === 'reveal') && question != null
  const showOfflineBanner = connection === 'offline' && phase !== 'join' && phase !== 'joining'

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {!inGameplay && <Logo compact />}
            {code && phase !== 'join' && phase !== 'joining' && (
              <span className="rounded-md border border-line bg-card px-2 py-1 text-xs font-bold text-ink-2 tabular-nums">
                Room {code}
              </span>
            )}
            {inGameplay && question && (
              <span className="text-xs font-bold text-ink-2 tabular-nums">
                Question {question.index + 1} / {question.total}
              </span>
            )}
          </div>
          {connection === 'offline' && phase !== 'join' && phase !== 'joining' && (
            <ConnectionPill state="offline" />
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {showOfflineBanner && (
          <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-xs font-semibold text-warn">
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
    <div className="my-auto py-4 animate-rise">
      <h1 className="text-4xl leading-tight font-extrabold tracking-tight">Join a game</h1>
      <p className="mt-2 text-sm text-ink-2">Enter the code on the board and pick a nickname.</p>

      <div className="mt-6">
        <ErrorBanner message={error} onDismiss={onDismissError} />
        <form onSubmit={onSubmit} className="card-strong p-5">
          <label htmlFor="room-code" className="text-sm font-bold text-ink">
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
            className="field mt-2 text-center text-3xl font-extrabold tracking-[0.28em] tabular-nums placeholder:text-ink-3/50"
          />

          <label htmlFor="nickname" className="mt-4 block text-sm font-bold text-ink">
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
          <p className="mt-1.5 text-xs text-ink-3">
            If someone beat you to it, the room adds a number.
          </p>

          <button
            type="submit"
            disabled={!online}
            aria-busy={!online}
            className="btn-primary mt-5 w-full py-3.5"
          >
            Join room
            <ArrowRight className="size-4" />
          </button>
          {!online && (
            <p className="mt-2.5 flex items-center justify-center gap-2 text-center text-xs font-semibold text-ink-3">
              <PulseDot className="size-1.5" tone="bg-warn" />
              Connecting to the game server…
            </p>
          )}
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-ink-3">
        No account needed. This browser remembers your seat if the connection drops.
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
      <span className="relative mx-auto grid size-12 place-items-center rounded-xl border border-line bg-card">
        {online ? (
          <>
            <span className="absolute inset-0 animate-ping rounded-xl border border-cobalt/40" />
            <Loader2 className="size-5 animate-spin text-cobalt" />
          </>
        ) : (
          <WifiOff className="size-5 text-wrong" />
        )}
      </span>
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
        {online ? 'Joining the room…' : 'Can’t reach the server'}
      </h1>
      <p className="mt-1.5 text-sm text-ink-2">{code ? `Room ${code}` : 'Hold tight'}</p>
      {error && <p className="mt-3 text-sm font-semibold text-wrong">{error}</p>}
      <button type="button" onClick={onCancel} className="btn-ghost mt-6 px-4 py-2.5 text-sm">
        <ChevronLeft className="size-4" />
        Back to join
      </button>
    </div>
  )
}

function LobbyView({ nickname, code }: { nickname: string; code: string }) {
  return (
    <div className="my-auto py-8 text-center animate-rise">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-correct text-white">
        <Check className="size-6" strokeWidth={3} />
      </span>

      <h1 className="mt-5 text-3xl font-extrabold tracking-tight break-words">{nickname}</h1>
      <p className="mt-1.5 text-sm font-semibold text-ink-2 tabular-nums">Room {code}</p>

      <div className="card mt-6 px-4 py-6 sm:px-5">
        <p className="inline-flex items-center gap-2 text-base font-bold text-ink">
          <PulseDot className="size-2" />
          Waiting for the host to start
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Keep this screen open. The first question arrives with everyone else’s.
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

  const status = ineligible
    ? null
    : !started
      ? 'Get ready — answers open when the timer starts.'
      : ended
        ? 'Time is up — waiting for the results…'
        : !online
          ? 'Reconnecting — answers are paused.'
          : selectedChoice != null
            ? 'Locked in. Tap another option to change it.'
            : 'Tap your answer. You can change it until time runs out.'

  return (
    <div className="flex flex-1 flex-col animate-rise">
      <TimerBar seconds={seconds} progress={progress} />

      <p className="mt-4 text-xs font-bold text-ink-3">
        {question.type === 'true_false' ? 'True or false' : 'Choose one answer'}
      </p>
      <h1 className="mt-1.5 text-2xl leading-tight font-extrabold tracking-tight text-balance">
        {question.text}
      </h1>

      {ineligible && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-sm font-semibold text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          You joined mid-question — scoring starts on the next question.
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2.5">
        {question.options.map((option, index) => {
          const selected = selectedChoice === index
          return (
            <button
              key={index}
              type="button"
              onClick={() => onChoose(index)}
              disabled={locked}
              aria-pressed={selected}
              style={selected ? { backgroundColor: `${choiceColor(index)}14` } : undefined}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-[border-color,background-color,opacity] duration-150 disabled:cursor-not-allowed ${
                selected ? 'border-ink' : 'border-line bg-card'
              } ${locked && !selected ? 'opacity-50' : ''}`}
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-extrabold text-white"
                style={{ backgroundColor: choiceColor(index) }}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <ChoiceShape index={index} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 text-base leading-snug font-semibold text-ink">
                {option}
              </span>
              {selected && <Check className="size-5 shrink-0 text-ink" strokeWidth={3} />}
            </button>
          )
        })}
      </div>

      {status && (
        <p className="mt-auto pt-4 text-center text-xs font-semibold text-ink-3" aria-live="polite">
          {status}
        </p>
      )}
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
  const heading = correct ? 'Correct!' : picked ? 'Not quite' : 'Time’s up'
  const tone = correct ? 'correct' : picked ? 'wrong' : 'warn'

  const box =
    tone === 'correct'
      ? 'border-correct bg-correct-soft text-correct'
      : tone === 'wrong'
        ? 'border-wrong bg-wrong-soft text-wrong'
        : 'border-warn bg-warn-soft text-warn'

  const Icon = tone === 'correct' ? Check : tone === 'wrong' ? X : Clock
  const badge = tone === 'correct' ? 'bg-correct' : tone === 'wrong' ? 'bg-wrong' : 'bg-warn'

  return (
    <div className="flex flex-1 flex-col py-2 animate-rise">
      <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${box}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg text-white ${badge}`}>
          <Icon className="size-5" strokeWidth={3} />
        </span>
        <div>
          <p className="text-xl font-extrabold tracking-tight">{heading}</p>
          <p className="text-sm font-semibold">
            {picked
              ? `+${result.points} points`
              : 'No answer locked in for this question.'}
          </p>
        </div>
      </div>

      <div className="card mt-3 grid grid-cols-3 divide-x divide-line">
        <div className="px-3 py-3 text-center">
          <p className="text-xs font-semibold text-ink-3">Points</p>
          <p
            key={result.points}
            className={`mt-0.5 text-2xl font-extrabold tabular-nums animate-pop ${
              result.points > 0 ? 'text-correct' : 'text-wrong'
            }`}
          >
            +{result.points}
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-xs font-semibold text-ink-3">Total</p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums">
            {result.totalScore.toLocaleString()}
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-xs font-semibold text-ink-3">Rank</p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums">#{result.rank}</p>
        </div>
      </div>

      {question && (
        <>
          <h2 className="mt-5 text-base leading-snug font-bold text-balance">{question.text}</h2>
          <div className="mt-2.5 flex flex-col gap-2">
            {question.options.map((option, index) => {
              const isCorrect = index === result.correctIndex
              const isWrongPick = selectedChoice === index && !isCorrect
              return (
                <div
                  key={index}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                    isCorrect
                      ? 'border-correct bg-correct-soft'
                      : isWrongPick
                        ? 'border-wrong bg-wrong-soft'
                        : 'border-line bg-card opacity-70'
                  }`}
                >
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded text-xs font-extrabold text-white"
                    style={{ backgroundColor: choiceColor(index) }}
                  >
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">{option}</span>
                  {isCorrect && <Check className="size-4 shrink-0 text-correct" strokeWidth={3} />}
                  {isWrongPick && <X className="size-4 shrink-0 text-wrong" strokeWidth={3} />}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="mt-5">
        <p className="mb-2 text-xs font-bold text-ink-3">Top 5 right now</p>
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
    <div className="flex flex-1 flex-col justify-center py-4 animate-rise">
      <div className="card-strong p-5 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-ink text-paper">
          {won ? <Crown className="size-5" /> : <Check className="size-5" strokeWidth={3} />}
        </span>
        <p className="mt-3 text-sm font-bold text-ink-2">{won ? 'You won the room.' : 'Final result'}</p>
        <p className="mt-1 text-5xl font-extrabold tabular-nums">#{final.rank}</p>
        <p className="mt-1 text-sm font-semibold text-ink-2 tabular-nums">
          {final.score.toLocaleString()} points · {nickname}
        </p>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-bold text-ink-3">Top 5</p>
        <Leaderboard rows={final.rows} highlight={nickname} limit={5} />
      </div>

      <button type="button" onClick={onPlayAgain} className="btn-primary mt-5 w-full py-3.5">
        Join another game
        <ArrowRight className="size-4" />
      </button>
    </div>
  )
}
