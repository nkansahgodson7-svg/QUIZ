import { useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { ErrorBanner } from '../ErrorBanner'
import type { QuestionType } from '../../lib/contract'
import {
  createQuiz,
  describeApiError,
  updateQuiz,
  type Quiz,
  type QuizInput,
  type QuizQuestion,
} from '../../lib/api'

interface DraftQuestion {
  key: string
  type: QuestionType
  text: string
  options: string[]
  correctIndex: number
  durationSec: number
}

interface DraftQuiz {
  title: string
  questions: DraftQuestion[]
}

let draftSequence = 0

function nextKey() {
  draftSequence += 1
  return `draft-question-${draftSequence}`
}

function makeQuestion(): DraftQuestion {
  return {
    key: nextKey(),
    type: 'multiple_choice',
    text: '',
    options: ['', ''],
    correctIndex: 0,
    durationSec: 20,
  }
}

function toDraft(quiz: Quiz | null): DraftQuiz {
  if (!quiz) return { title: '', questions: [makeQuestion()] }
  return {
    title: quiz.title,
    questions:
      quiz.questions.length > 0
        ? quiz.questions.map((question) => ({
            key: nextKey(),
            type: question.type,
            text: question.text,
            options:
              question.type === 'true_false' ? ['True', 'False'] : [...question.options],
            correctIndex: question.correctIndex,
            durationSec: question.durationSec,
          }))
        : [makeQuestion()],
  }
}

function validateDraft(draft: DraftQuiz): QuizInput | string {
  const title = draft.title.trim()
  if (!title) return 'Give the quiz a title.'
  if (title.length > 120) return 'Quiz titles can be at most 120 characters.'
  if (draft.questions.length === 0) return 'Add at least one question.'
  if (draft.questions.length > 100) return 'A quiz can have at most 100 questions.'

  const questions: QuizQuestion[] = []
  for (let index = 0; index < draft.questions.length; index += 1) {
    const question = draft.questions[index]
    const label = `Question ${index + 1}`
    const text = question.text.trim()

    if (!text) return `${label} needs some text.`
    if (text.length > 1000) return `${label} text is too long.`
    if (
      !Number.isInteger(question.durationSec) ||
      question.durationSec < 1 ||
      question.durationSec > 300
    ) {
      return `${label} duration must be a whole number from 1 to 300 seconds.`
    }

    if (question.type === 'true_false') {
      if (question.correctIndex !== 0 && question.correctIndex !== 1) {
        return `${label} needs a correct answer.`
      }
      questions.push({
        type: 'true_false',
        text,
        options: ['True', 'False'],
        correctIndex: question.correctIndex,
        durationSec: question.durationSec,
      })
      continue
    }

    if (question.options.length < 2 || question.options.length > 4) {
      return `${label} needs 2 to 4 options.`
    }
    const options = question.options.map((option) => option.trim())
    if (options.some((option) => !option)) return `${label} has an empty option.`
    if (options.some((option) => option.length > 200)) {
      return `${label} has an option that is too long.`
    }
    if (question.correctIndex < 0 || question.correctIndex >= options.length) {
      return `${label} needs a correct option.`
    }
    questions.push({
      type: 'multiple_choice',
      text,
      options,
      correctIndex: question.correctIndex,
      durationSec: question.durationSec,
    })
  }

  return { title, questions }
}

const ICON_BUTTON =
  'grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-mist-400 transition-colors hover:border-white/25 hover:text-mist-100 disabled:pointer-events-none disabled:opacity-30'

export function QuizBuilder({
  token,
  quiz,
  onSaved,
  onCancel,
}: {
  token: string
  quiz: Quiz | null
  onSaved: (quiz: Quiz) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<DraftQuiz>(() => toDraft(quiz))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    }))
  }

  function changeType(index: number, type: QuestionType) {
    const question = draft.questions[index]
    if (!question || question.type === type) return
    if (type === 'true_false') {
      updateQuestion(index, { type, options: ['True', 'False'], correctIndex: 0 })
    } else {
      updateQuestion(index, { type, options: ['', ''], correctIndex: 0 })
    }
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= draft.questions.length) return
    setDraft((current) => {
      const questions = [...current.questions]
      const [question] = questions.splice(index, 1)
      questions.splice(target, 0, question)
      return { ...current, questions }
    })
  }

  function removeQuestion(index: number) {
    setDraft((current) => {
      if (current.questions.length <= 1) return current
      return {
        ...current,
        questions: current.questions.filter((_, questionIndex) => questionIndex !== index),
      }
    })
  }

  function addQuestion() {
    setDraft((current) => ({ ...current, questions: [...current.questions, makeQuestion()] }))
  }

  function removeOption(index: number, optionIndex: number) {
    const question = draft.questions[index]
    if (!question || question.options.length <= 2) return
    const options = question.options.filter((_, currentIndex) => currentIndex !== optionIndex)
    let correctIndex = question.correctIndex
    if (correctIndex === optionIndex) correctIndex = 0
    else if (correctIndex > optionIndex) correctIndex -= 1
    updateQuestion(index, { options, correctIndex })
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const input = validateDraft(draft)
    if (typeof input === 'string') {
      setError(input)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const saved = quiz ? await updateQuiz(token, quiz.id, input) : await createQuiz(token, input)
      onSaved(saved)
    } catch (saveError) {
      setError(describeApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mx-auto w-full max-w-4xl py-6 animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-sm text-mist-400 transition-colors hover:text-mist-200"
          >
            <ArrowLeft className="size-4" />
            Back to saved quizzes
          </button>
          <p className="eyebrow mt-5">Quiz builder</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
            {quiz ? 'Edit quiz.' : 'Build a quiz.'}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-mist-400">
            Every question has its own time limit. Multiple choice takes 2–4 options; true/false
            always uses True and False.
          </p>
        </div>
        <button type="submit" disabled={saving} className="btn-primary px-5 py-3 text-sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? 'Saving…' : 'Save quiz'}
        </button>
      </div>

      <div className="mt-6">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </div>

      <div className="panel p-5 sm:p-6">
        <label htmlFor="quiz-title" className="text-sm font-medium text-mist-200">
          Quiz title
        </label>
        <input
          id="quiz-title"
          value={draft.title}
          onChange={(event) =>
            setDraft((current) => ({ ...current, title: event.target.value }))
          }
          maxLength={120}
          placeholder="e.g. The Big Brain Warm-Up"
          className="field mt-2"
        />
        <p className="mt-2 text-xs text-mist-500">{draft.title.trim().length}/120 characters</p>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={question.key}
            question={question}
            index={index}
            total={draft.questions.length}
            onChange={(patch) => updateQuestion(index, patch)}
            onTypeChange={(type) => changeType(index, type)}
            onMove={(direction) => moveQuestion(index, direction)}
            onRemove={() => removeQuestion(index)}
            onOptionRemove={(optionIndex) => removeOption(index, optionIndex)}
            onOptionAdd={() =>
              updateQuestion(index, { options: [...question.options, ''] })
            }
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addQuestion}
        className="btn-ghost mt-4 w-full border-dashed py-3 text-sm"
      >
        <Plus className="size-4" />
        Add question
      </button>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost px-4 py-2.5 text-sm">
          <ArrowLeft className="size-4" />
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary px-5 py-2.5 text-sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? 'Saving…' : quiz ? 'Save changes' : 'Create quiz'}
        </button>
      </div>
    </form>
  )
}

function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onTypeChange,
  onMove,
  onRemove,
  onOptionRemove,
  onOptionAdd,
}: {
  question: DraftQuestion
  index: number
  total: number
  onChange: (patch: Partial<DraftQuestion>) => void
  onTypeChange: (type: QuestionType) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onOptionRemove: (optionIndex: number) => void
  onOptionAdd: () => void
}) {
  const isTrueFalse = question.type === 'true_false'

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl bg-iris-500/15 text-sm font-bold text-iris-400 tabular-nums">
            {index + 1}
          </span>
          <p className="text-sm font-semibold text-mist-200">Question {index + 1}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className={ICON_BUTTON}
            aria-label={`Move question ${index + 1} up`}
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className={ICON_BUTTON}
            aria-label={`Move question ${index + 1} down`}
          >
            <ArrowDown className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total <= 1}
            className={`${ICON_BUTTON} hover:border-coral-400/40 hover:text-coral-400`}
            aria-label={`Delete question ${index + 1}`}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div>
          <label
            htmlFor={`question-type-${question.key}`}
            className="text-xs font-medium text-mist-400"
          >
            Question type
          </label>
          <select
            id={`question-type-${question.key}`}
            value={question.type}
            onChange={(event) => onTypeChange(event.target.value as QuestionType)}
            className="field mt-1.5 text-sm"
          >
            <option value="multiple_choice">Multiple choice</option>
            <option value="true_false">True / False</option>
          </select>
        </div>
        <div>
          <label
            htmlFor={`question-duration-${question.key}`}
            className="text-xs font-medium text-mist-400"
          >
            Time limit (sec)
          </label>
          <input
            id={`question-duration-${question.key}`}
            type="number"
            min={1}
            max={300}
            step={1}
            value={question.durationSec}
            onChange={(event) => onChange({ durationSec: Number(event.target.value) })}
            className="field mt-1.5 text-sm tabular-nums"
          />
        </div>
      </div>

      <label
        htmlFor={`question-text-${question.key}`}
        className="mt-4 block text-xs font-medium text-mist-400"
      >
        Question
      </label>
      <textarea
        id={`question-text-${question.key}`}
        value={question.text}
        onChange={(event) => onChange({ text: event.target.value })}
        rows={2}
        maxLength={1000}
        placeholder="e.g. Which planet is known as the Red Planet?"
        className="field mt-1.5 resize-y text-sm"
      />

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-mist-400">
            {isTrueFalse ? 'Correct answer' : 'Options — pick the correct one'}
          </p>
          {!isTrueFalse && (
            <span className="text-[0.65rem] font-medium tracking-[0.14em] text-mist-500 uppercase">
              {question.options.length}/4
            </span>
          )}
        </div>

        {isTrueFalse ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {question.options.map((option, optionIndex) => {
              const selected = question.correctIndex === optionIndex
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                    selected
                      ? 'border-acid-400/60 bg-acid-400/10'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <input
                    type="radio"
                    name={`correct-${question.key}`}
                    checked={selected}
                    onChange={() => onChange({ correctIndex: optionIndex })}
                    className="sr-only"
                  />
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full border ${
                      selected
                        ? 'border-acid-400 bg-acid-400 text-night-950'
                        : 'border-white/20 text-transparent'
                    }`}
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span className="font-medium text-mist-100">{option}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {question.options.map((option, optionIndex) => {
              const selected = question.correctIndex === optionIndex
              const letter = String.fromCharCode(65 + optionIndex)
              return (
                <div key={optionIndex} className="flex items-center gap-2">
                  <label
                    aria-label={`Mark option ${letter} correct`}
                    className={`grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border text-xs font-bold transition-colors ${
                      selected
                        ? 'border-acid-400 bg-acid-400 text-night-950'
                        : 'border-white/12 bg-white/[0.03] text-mist-400 hover:border-white/25'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`correct-${question.key}`}
                      checked={selected}
                      onChange={() => onChange({ correctIndex: optionIndex })}
                      className="sr-only"
                    />
                    {selected ? <Check className="size-4" strokeWidth={3} /> : letter}
                  </label>
                  <input
                    value={option}
                    onChange={(event) =>
                      onChange({
                        options: question.options.map((currentOption, currentIndex) =>
                          currentIndex === optionIndex ? event.target.value : currentOption,
                        ),
                      })
                    }
                    maxLength={200}
                    placeholder={`Option ${letter}`}
                    aria-label={`Option ${letter}`}
                    className="field text-sm"
                  />
                  {question.options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => onOptionRemove(optionIndex)}
                      className={ICON_BUTTON}
                      aria-label={`Remove option ${letter}`}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              )
            })}
            {question.options.length < 4 && (
              <button
                type="button"
                onClick={onOptionAdd}
                className="mt-1 inline-flex items-center gap-1.5 self-start rounded-xl px-2 py-1 text-xs font-semibold text-iris-400 transition-colors hover:text-iris-300"
              >
                <Plus className="size-3.5" />
                Add option
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
