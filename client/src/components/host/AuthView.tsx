import { useState } from 'react'
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { ErrorBanner } from '../ErrorBanner'

export type AuthMode = 'login' | 'signup'

export function AuthView({
  busy,
  error,
  onDismissError,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onDismissError: () => void
  onSubmit: (mode: AuthMode, email: string, password: string) => void
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function switchMode(next: AuthMode) {
    setMode(next)
    setLocalError(null)
    onDismissError()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setLocalError('Enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.')
      return
    }
    setLocalError(null)
    onSubmit(mode, cleanEmail, password)
  }

  return (
    <div className="mx-auto my-auto w-full max-w-md py-8 animate-rise">
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-mist-300">
        <ShieldCheck className="size-3.5 text-acid-300" />
        Host account
      </span>
      <h1 className="mt-4 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
        {mode === 'login' ? 'Welcome back.' : 'Create your host account.'}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-mist-400">
        Sign in to build quizzes, open rooms, and review past games. Players never need an account.
      </p>

      <div className="mt-7 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        <button
          type="button"
          onClick={() => switchMode('login')}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            mode === 'login'
              ? 'bg-acid-400 text-night-950'
              : 'text-mist-400 hover:text-mist-200'
          }`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => switchMode('signup')}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            mode === 'signup'
              ? 'bg-acid-400 text-night-950'
              : 'text-mist-400 hover:text-mist-200'
          }`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={submit} className="panel mt-4 p-6">
        <ErrorBanner
          message={localError ?? error}
          onDismiss={() => {
            setLocalError(null)
            onDismissError()
          }}
        />

        <label htmlFor="host-email" className="text-sm font-medium text-mist-200">
          Email
        </label>
        <div className="relative mt-2">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mist-500" />
          <input
            id="host-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@school.edu"
            required
            className="field pl-10"
          />
        </div>

        <label htmlFor="host-password" className="mt-4 block text-sm font-medium text-mist-200">
          Password
        </label>
        <div className="relative mt-2">
          <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mist-500" />
          <input
            id="host-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="At least 6 characters"
            minLength={6}
            required
            className="field pl-10"
          />
        </div>

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === 'login' ? 'Logging in…' : 'Creating account…'}
            </>
          ) : (
            <>
              {mode === 'login' ? 'Log in' : 'Create account'}
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <p className="mt-4 px-2 text-center text-xs leading-relaxed text-mist-500">
        Your host token is stored in this browser so you stay signed in. Log out any time.
      </p>
    </div>
  )
}
