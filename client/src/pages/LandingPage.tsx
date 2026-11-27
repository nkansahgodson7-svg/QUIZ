import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, LogIn } from 'lucide-react'
import { Logo } from '../components/Logo'

export function LandingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [code, setCode] = useState(() =>
    (searchParams.get('code') ?? '').replace(/\D/g, '').slice(0, 6),
  )

  const cleanCode = code.replace(/\D/g, '').slice(0, 6)

  // A scanned QR link already carries the room code, so skip the code screen
  // and go straight to picking a nickname.
  if (cleanCode.length === 6) {
    return <Navigate to={`/play?code=${cleanCode}`} replace />
  }

  function join(event: React.FormEvent) {
    event.preventDefault()
    if (cleanCode.length !== 6) return
    navigate(`/play?code=${cleanCode}`)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
        <Logo />
        <Link to="/host" className="btn-ghost px-3.5 py-2 text-sm">
          <LogIn className="size-4" />
          Host a quiz
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-8">
        <h1 className="text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl">
          Join a quiz.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-2">
          Type the six-digit code shown on the board.
        </p>

        <form onSubmit={join} className="card-strong mt-7 p-4 sm:p-6">
          <label htmlFor="join-code" className="text-sm font-bold text-ink">
            Room code
          </label>
          <input
            id="join-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            aria-label="Six digit room code"
            className="field mt-2 text-center text-3xl font-extrabold tracking-[0.28em] tabular-nums placeholder:text-ink-3/50"
          />

          <button
            type="submit"
            disabled={cleanCode.length !== 6}
            className="btn-primary mt-4 w-full py-3.5 text-base"
          >
            Join game
            <ArrowRight className="size-4" />
          </button>
          <p className="mt-2.5 text-center text-xs text-ink-3">
            {cleanCode.length === 6 ? 'Ready when you are.' : 'All six digits unlock the button.'}
          </p>
        </form>

        <div className="mt-8 flex items-center justify-between gap-4 border-t border-line pt-5">
          <div>
            <p className="text-sm font-bold text-ink">Hosting instead?</p>
            <p className="mt-0.5 text-xs text-ink-3">Build a quiz and share a room code.</p>
          </div>
          <Link to="/host" className="btn-ink px-4 py-2.5 text-sm">
            Host a quiz
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>
    </div>
  )
}
