import { Link } from 'react-router-dom'
import { ArrowUpRight, Crown, Smartphone, Timer, Trophy, Users } from 'lucide-react'
import { Backdrop } from '../components/Backdrop'
import { Logo } from '../components/Logo'

const STATS = [
  { icon: Users, label: '300+ players per room' },
  { icon: Timer, label: 'One shared timer' },
  { icon: Trophy, label: 'Top 5 on every phone' },
]

export function LandingPage() {
  return (
    <div className="relative min-h-svh">
      <Backdrop />
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Logo />
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mist-300">
            Live classroom quiz
          </span>
        </header>

        <main className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-20">
          <section className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-acid-400/25 bg-acid-400/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-acid-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-acid-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-acid-400" />
              </span>
              No account needed to play
            </span>

            <h1 className="mt-6 text-[3.4rem] leading-[0.92] font-bold tracking-[-0.04em] text-balance sm:text-7xl lg:text-[5.5rem]">
              Learning,
              <br />
              <span className="text-acid-400">but louder.</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-mist-300">
              Host a quiz on the big screen. Everyone joins from their phone with a six-digit
              code, races the same countdown, and climbs the leaderboard.
            </p>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
              {STATS.map(({ icon: Icon, label }) => (
                <span key={label} className="flex items-center gap-2 text-sm text-mist-400">
                  <Icon className="size-4 text-mist-500" />
                  {label}
                </span>
              ))}
            </div>
          </section>

          <section className="grid gap-4 animate-rise [animation-delay:120ms]">
            <Link
              to="/host"
              className="group panel relative overflow-hidden p-6 transition-colors hover:border-acid-400/35 sm:p-7"
            >
              <div className="absolute -top-10 -right-8 size-40 rounded-full bg-acid-400/10 blur-2xl transition-colors group-hover:bg-acid-400/15" />
              <div className="relative flex items-start justify-between gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-acid-400 text-night-950">
                  <Crown className="size-6" strokeWidth={2.2} />
                </span>
                <ArrowUpRight className="size-5 text-mist-500 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-acid-300" />
              </div>
              <h2 className="relative mt-5 text-2xl font-bold">Host a room</h2>
              <p className="relative mt-1.5 text-sm leading-relaxed text-mist-400">
                Open a room from a saved quiz, share the code, and run the game from the big
                screen.
              </p>
            </Link>

            <Link
              to="/play"
              className="group panel relative overflow-hidden p-6 transition-colors hover:border-iris-400/45 sm:p-7"
            >
              <div className="absolute -top-10 -right-8 size-40 rounded-full bg-iris-500/15 blur-2xl transition-colors group-hover:bg-iris-500/25" />
              <div className="relative flex items-start justify-between gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-iris-500 text-white">
                  <Smartphone className="size-6" strokeWidth={2.2} />
                </span>
                <ArrowUpRight className="size-5 text-mist-500 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-iris-400" />
              </div>
              <h2 className="relative mt-5 text-2xl font-bold">Join a game</h2>
              <p className="relative mt-1.5 text-sm leading-relaxed text-mist-400">
                Got a code? Pick a nickname, answer on your phone, and watch your rank climb.
              </p>
            </Link>

            <p className="px-1 text-center text-xs text-mist-500">
              Built phone-first for players · auto-advancing questions
            </p>
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5 text-xs text-mist-500">
          <span>Quizzly · socket contract v1</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-acid-400/80" />
            Mock-friendly development build
          </span>
        </footer>
      </div>
    </div>
  )
}
