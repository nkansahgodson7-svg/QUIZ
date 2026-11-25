export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-night-950">
      <div className="absolute -top-52 -right-32 size-[38rem] rounded-full bg-iris-500/25 blur-[130px] animate-drift" />
      <div className="absolute -bottom-56 -left-40 size-[34rem] rounded-full bg-acid-500/12 blur-[140px]" />
      <div className="absolute top-1/3 left-1/2 size-[24rem] -translate-x-1/2 rounded-full bg-aqua-400/8 blur-[130px]" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 35%, black 10%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 35%, black 10%, transparent 72%)',
        }}
      />
    </div>
  )
}
