import { ChoiceShape, choiceColor } from '../ChoiceShape'
import { PulseDot, Skeleton } from '../Loading'
import type { GameQuestion, HostLiveState } from '../../lib/contract'

export function QuestionMonitor({
  question,
  liveState,
  locked,
}: {
  question: GameQuestion
  liveState: HostLiveState | null
  locked: boolean
}) {
  const live = liveState && liveState.index === question.index ? liveState : null
  const correctIndex =
    typeof question.correctIndex === 'number'
      ? question.correctIndex
      : live
        ? live.correctIndex
        : null

  return (
    <section className="card flex h-full flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight">Live question</h2>
          <p className="mt-0.5 text-xs font-semibold text-ink-3 tabular-nums">
            Question {question.index + 1} of {question.total}
          </p>
        </div>
        <span className="tile px-2 py-1 text-xs">
          {question.type === 'true_false' ? 'True / False' : 'Multiple choice'}
        </span>
      </div>

      <p className="mt-3 text-lg leading-snug font-bold tracking-tight text-balance sm:text-xl">
        {question.text}
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {question.options.map((option, index) => {
          const count = live ? (live.choiceCounts[index] ?? 0) : null
          const percent =
            live && live.answered > 0
              ? Math.round(((count ?? 0) / live.answered) * 100)
              : live
                ? 0
                : null
          const isCorrect = correctIndex === index

          return (
            <li
              key={index}
              className={`overflow-hidden rounded-xl border ${
                isCorrect ? 'border-correct/40 bg-correct-soft' : 'border-line bg-paper'
              }`}
            >
              <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-md text-xs font-extrabold text-white"
                  style={{ backgroundColor: choiceColor(index) }}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                <ChoiceShape index={index} className="mt-1 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-semibold text-ink">{option}</p>
                  {isCorrect && (
                    <span className="mt-1 inline-block rounded border border-correct/30 bg-correct-soft px-1.5 py-0.5 text-[0.65rem] font-bold text-correct">
                      Correct answer
                    </span>
                  )}
                </div>
                <span className="flex w-16 shrink-0 items-center justify-end text-right text-xs font-bold text-ink-2 tabular-nums">
                  {count == null ? (
                    <Skeleton className="h-3 w-8" />
                  ) : (
                    <>
                      {count}
                      {percent != null && (
                        <span className="font-semibold text-ink-3"> ({percent}%)</span>
                      )}
                    </>
                  )}
                </span>
              </div>
              <div className={`h-1.5 ${live ? 'bg-line/40' : 'skeleton'}`}>
                <div
                  className="h-full transition-[width] duration-300"
                  style={{
                    width: `${percent ?? 0}%`,
                    backgroundColor: choiceColor(index),
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-auto pt-4 text-xs font-semibold text-ink-2">
        {locked ? (
          'Answers are locked — results are landing on player phones.'
        ) : live ? (
          'Players answer on their phones and can change their answer until the clock runs out.'
        ) : (
          <span className="inline-flex items-center gap-2">
            <PulseDot className="size-1.5" />
            Collecting the first answers…
          </span>
        )}
      </p>
    </section>
  )
}
