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
      className="mb-5 flex items-start gap-3 rounded-2xl border border-coral-400/30 bg-coral-400/10 px-4 py-3 text-sm text-[#ffc4b8] animate-rise"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-coral-400" />
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="rounded-lg p-0.5 text-[#ffc4b8]/70 transition-colors hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
