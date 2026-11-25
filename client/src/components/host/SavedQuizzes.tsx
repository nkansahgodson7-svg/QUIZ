import { ListChecks, Loader2, Pencil, Plus, Radio, Trash2 } from 'lucide-react'
import type { Quiz } from '../../lib/api'
import type { ConnectionState } from '../ConnectionPill'

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-mist-100">Saved quizzes</h2>
          <p className="mt-1 text-sm text-mist-400">
            Open a room from any quiz, or edit it before class.
          </p>
        </div>
        <button type="button" onClick={onCreate} className="btn-primary px-4 py-2.5 text-sm">
          <Plus className="size-4" />
          New quiz
        </button>
      </div>

      {connection !== 'connected' && (
        <p className="mt-3 rounded-xl border border-[#ffd08a]/25 bg-[#ffd08a]/10 px-3 py-2 text-xs text-[#ffe1b0]">
          Connecting to the game server — rooms can be opened once the host connection is live.
        </p>
      )}

      {loading && quizzes.length === 0 ? (
        <div className="panel mt-5 flex items-center justify-center gap-2 px-5 py-12 text-sm text-mist-400">
          <Loader2 className="size-4 animate-spin" />
          Loading your quizzes…
        </div>
      ) : quizzes.length === 0 ? (
        <div className="panel mt-5 px-6 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-iris-500/15 text-iris-400">
            <ListChecks className="size-6" />
          </span>
          <p className="mt-4 font-semibold text-mist-100">No saved quizzes yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-mist-400">
            Build your first quiz with multiple-choice or true/false questions, then open a room
            and share the code.
          </p>
          <button type="button" onClick={onCreate} className="btn-primary mt-5 px-5 py-2.5 text-sm">
            <Plus className="size-4" />
            Build a quiz
          </button>
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {quizzes.map((quiz) => {
            const opening = openingId === quiz.id
            const deleting = deletingId === quiz.id
            const busy = openingId !== null || deletingId !== null
            return (
              <li key={quiz.id} className="panel p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-mist-100">{quiz.title}</h3>
                    <p className="mt-1 text-xs text-mist-500">
                      {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} ·
                      Updated {formatUpdated(quiz.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(quiz)}
                      disabled={busy || connection !== 'connected'}
                      className="btn-primary px-4 py-2.5 text-sm"
                      title={
                        connection === 'connected'
                          ? 'Open a room from this quiz'
                          : 'Waiting for the host connection'
                      }
                    >
                      {opening ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Radio className="size-4" />
                      )}
                      {opening ? 'Opening…' : 'Open room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(quiz)}
                      disabled={busy}
                      className="btn-ghost px-4 py-2.5 text-sm"
                    >
                      <Pencil className="size-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(quiz)}
                      disabled={busy}
                      className="btn-ghost px-4 py-2.5 text-sm text-coral-400 hover:border-coral-400/40 hover:text-coral-400"
                    >
                      {deleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
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
