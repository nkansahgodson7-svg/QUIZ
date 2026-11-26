import { ListChecks, Pencil, Plus, Radio, Trash2 } from 'lucide-react'
import type { Quiz } from '../../lib/api'
import type { ConnectionState } from '../ConnectionPill'
import { Skeleton, Spinner } from '../Loading'

function formatUpdated(value?: string): string {
  if (!value) return 'just now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SavedQuizzes({
  quizzes,
  loading,
  connection,
  openingId,
  deletingId,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
}: {
  quizzes: Quiz[]
  loading: boolean
  connection: ConnectionState
  openingId: string | null
  deletingId: string | null
  onOpen: (quiz: Quiz) => void
  onEdit: (quiz: Quiz) => void
  onDelete: (quiz: Quiz) => void
  onCreate: () => void
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">Saved quizzes</h2>
        <div className="flex items-center gap-3">
          {loading && quizzes.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3">
              <Spinner className="size-3" />
              Refreshing…
            </span>
          )}
          <button type="button" onClick={onCreate} className="btn-primary px-4 py-2.5">
            <Plus className="size-4" />
            New quiz
          </button>
        </div>
      </div>

      {connection !== 'connected' && (
        <p className="mt-3 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
          Connecting to the game server — rooms can be opened once the host connection is live.
        </p>
      )}

      {loading && quizzes.length === 0 ? (
        <div role="status" aria-live="polite" className="mt-4 flex flex-col gap-3">
          <span className="sr-only">Loading your quizzes…</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-2/3 max-w-56" />
                  <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-10 w-28" />
                  <Skeleton className="h-10 w-20" />
                  <span className="hidden sm:block">
                    <Skeleton className="h-10 w-24" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="card mt-4 px-6 py-12 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border border-line bg-paper text-ink-2">
            <ListChecks className="size-5" />
          </span>
          <p className="mt-4 text-base font-bold">No saved quizzes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-2">
            Build a quiz with multiple-choice or true/false questions, then open a room and share
            the code.
          </p>
          <button type="button" onClick={onCreate} className="btn-primary mt-5 px-4 py-2.5">
            <Plus className="size-4" />
            Build a quiz
          </button>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {quizzes.map((quiz) => {
            const opening = openingId === quiz.id
            const deleting = deletingId === quiz.id
            const busy = openingId !== null || deletingId !== null
            return (
              <li key={quiz.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-extrabold tracking-tight">{quiz.title}</h3>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} ·
                      Updated {formatUpdated(quiz.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(quiz)}
                      disabled={busy || connection !== 'connected'}
                      className="btn-primary px-4 py-2.5"
                      title={
                        connection === 'connected'
                          ? 'Open a room from this quiz'
                          : 'Waiting for the host connection'
                      }
                    >
                      {opening ? <Spinner className="size-4" /> : <Radio className="size-4" />}
                      {opening ? 'Opening…' : 'Open room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(quiz)}
                      disabled={busy}
                      className="btn-ghost px-3.5 py-2.5"
                    >
                      <Pencil className="size-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(quiz)}
                      disabled={busy}
                      className="btn-ghost px-3.5 py-2.5 text-wrong hover:border-wrong"
                    >
                      {deleting ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
