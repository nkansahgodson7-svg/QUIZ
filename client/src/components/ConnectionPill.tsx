export type ConnectionState = 'connecting' | 'connected' | 'offline'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  connected: 'Live',
  offline: 'Offline',
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-300">
      <span className="relative flex size-2">
        {state === 'connecting' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-acid-400 opacity-70" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            state === 'connected'
              ? 'bg-acid-400'
              : state === 'connecting'
                ? 'bg-acid-400/80'
                : 'bg-coral-400'
          }`}
        />
      </span>
      {LABEL[state]}
    </span>
  )
}
