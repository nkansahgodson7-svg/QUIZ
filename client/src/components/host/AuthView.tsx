import { useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
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
    <div className="mx-auto my-auto w-full max-w-md py-6 animate-rise">
      <h1 className="text-4xl leading-tight font-extrabold tracking-tight">
        {mode === 'login' ? 'Host sign in' : 'Create a host account'}
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        {mode === 'login'
          ? 'Sign in to build quizzes and run rooms.'
          : 'One account covers every quiz you run.'}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1">
        <button
          type="button"
          onClick={() => switchMode('login')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
            mode === 'login' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
          }`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => switchMode('signup')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
            mode === 'signup' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
          }`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={submit} className="card-strong mt-4 p-5 sm:p-6">
        <ErrorBanner
          message={localError ?? error}
          onDismiss={() => {
            setLocalError(null)
            onDismissError()
          }}
        />

        <label htmlFor="host-email" className="text-sm font-bold text-ink">
          Email
        </label>
        <input
          id="host-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@school.edu"
          required
          className="field mt-2"
        />

        <label htmlFor="host-password" className="mt-4 block text-sm font-bold text-ink">
          Password
        </label>
        <input
          id="host-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="At least 6 characters"
          minLength={6}
          required
          className="field mt-2"
        />

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full py-3.5">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === 'login' ? 'Signing in…' : 'Creating account…'}
            </>
          ) : (
            <>
              {mode === 'login' ? 'Log in' : 'Create account'}
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <p className="mt-3 text-center text-xs text-ink-3">
        This browser keeps you signed in until you log out.
      </p>
    </div>
  )
}
