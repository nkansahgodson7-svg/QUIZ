import { PulseDot } from './Loading'

export type ConnectionState = 'connecting' | 'connected' | 'offline'

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-correct',
  connecting: 'bg-warn',
  offline: 'bg-wrong',
}

const LABEL: Record<ConnectionState, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline',
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-2.5 py-1 text-xs font-semibold text-ink-2"
      aria-live="polite"
    >
      {state === 'offline' ? (
        <span className={`size-2 rounded-full ${DOT[state]}`} />
      ) : (
        <PulseDot className="size-2" tone={DOT[state]} />
      )}
      {LABEL[state]}
    </span>
  )
}
