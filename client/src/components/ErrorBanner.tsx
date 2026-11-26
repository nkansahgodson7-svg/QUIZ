import { AlertCircle, X } from 'lucide-react'

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null
  onDismiss: () => void
}) {
  if (!message) return null

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-wrong/25 bg-wrong-soft px-4 py-3 text-sm text-wrong"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="rounded p-0.5 text-wrong/70 transition-colors hover:text-wrong"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
