import { Check, CircleStop, Copy, Flag } from 'lucide-react'
import { Leaderboard } from '../Leaderboard'
import { PulseDot } from '../Loading'
import { TimerBar } from '../Timer'
import type {
  AnswerCount,
  GameQuestion,
  HostLiveState,
  LeaderRow,
} from '../../lib/contract'
import { PlayersPanel } from './PlayersPanel'
import { QuestionMonitor } from './QuestionMonitor'

export function LiveConsole({
  code,
  question,
  answered,
  liveState,
  standings,
  playerCount,
  seconds,
  progress,
  locked,
  copied,
  online,
  onCopyCode,
  onEndQuestion,
  onEndGame,
}: {
  code: string
  question: GameQuestion
  answered: AnswerCount | null
  liveState: HostLiveState | null
  standings: LeaderRow[]
  playerCount: number
  seconds: number
  progress: number
  locked: boolean
  copied: boolean
  online: boolean
  onCopyCode: () => void
  onEndQuestion: () => void
  onEndGame: () => void
}) {
  const answeredCount = answered?.index === question.index ? answered.answered : 0
  const totalPlayers = answered?.index === question.index ? answered.total : playerCount
  const answeredPercent = totalPlayers > 0 ? Math.min(100, (answeredCount / totalPlayers) * 100) : 0
  const everyoneAnswered = totalPlayers > 0 && answeredCount >= totalPlayers
  const completedQuestions = question.index + (locked ? 1 : 0)

  return (
    <div className="w-full py-1 animate-rise">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold tracking-[0.08em] text-ink-3 uppercase">
                Question {question.index + 1} of {question.total}
              </p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase ${
                  locked
                    ? 'border-warn/25 bg-warn-soft text-warn'
                    : 'border-correct/25 bg-correct-soft text-correct'
                }`}
                aria-live="polite"
              >
                <PulseDot
                  className="size-1.5"
                  tone={locked ? 'bg-warn' : 'bg-correct'}
                />
                {locked ? 'Answers locked' : 'Live'}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              {question.total <= 10 && (
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {Array.from({ length: question.total }).map((_, index) => (
                    <span
                      key={index}
                      className={`size-1.5 rounded-full ${
                        index === question.index
                          ? 'bg-cobalt ring-2 ring-cobalt/25 ring-offset-1 ring-offset-card'
                          : index < question.index
                            ? 'bg-ink'
                            : 'bg-line-strong'
                      }`}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1">
                <span className="text-[0.65rem] font-bold tracking-wide text-ink-3 uppercase">
                  Room
                </span>
                <span className="text-sm font-extrabold tracking-[0.12em] tabular-nums">
                  {code}
                </span>
                <button
                  type="button"
                  onClick={onCopyCode}
                  aria-label="Copy room code"
                  className="rounded-md p-1 text-ink-3 transition-colors hover:bg-card hover:text-ink"
                >
                  {copied ? (
                    <Check className="size-3.5 text-correct" strokeWidth={3} />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="min-w-0 xl:w-80 xl:shrink-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.65rem] font-bold tracking-wide text-ink-3 uppercase">
                Time left
              </span>
              <span className="text-xs font-bold text-ink-2 tabular-nums">
                {answeredCount} / {totalPlayers} answered
              </span>
            </div>
            <div className="mt-1.5">
              <TimerBar seconds={seconds} progress={progress} />
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  everyoneAnswered ? 'bg-correct' : 'bg-ink'
                }`}
                style={{ width: `${answeredPercent}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
            <button
              type="button"
              onClick={onEndQuestion}
              disabled={locked || !online}
              className={`${everyoneAnswered && !locked ? 'btn-primary' : 'btn-ghost'} px-3 py-2 text-xs sm:text-sm`}
            >
              <CircleStop className="size-4" />
              End question now
            </button>
            <button
              type="button"
              onClick={onEndGame}
              disabled={!online}
              className="btn-ghost border-wrong/30 px-3 py-2 text-xs text-wrong hover:border-wrong hover:bg-wrong-soft sm:text-sm"
            >
              <Flag className="size-4" />
              End game
            </button>
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-7">
          <QuestionMonitor question={question} liveState={liveState} locked={locked} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <PlayersPanel liveState={liveState} playerCount={playerCount} />

          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold tracking-tight">Live standings</h2>
              <span className="text-xs font-semibold text-ink-3">
                {completedQuestions > 0
                  ? `Through Question ${completedQuestions}`
                  : 'Updates after each question'}
              </span>
            </div>
            <div className="mt-3">
              <Leaderboard
                rows={standings}
                limit={8}
                emptyLabel={
                  question.index === 0
                    ? 'Standings appear after Question 1'
                    : 'Standings appear after this question'
                }
              />
            </div>
            {standings.length > 8 && (
              <p className="mt-2 text-xs text-ink-3">
                Showing the top 8 of {standings.length} players.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
