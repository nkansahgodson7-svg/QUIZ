/** Answer accents: colour + shape + letter, so options stay distinct without colour. */
export const CHOICE_COLORS = ['#dc2626', '#2563eb', '#d97706', '#059669'] as const
export const CHOICE_SHAPES = ['Triangle', 'Diamond', 'Circle', 'Square'] as const

export function choiceColor(index: number): string {
  return CHOICE_COLORS[index % CHOICE_COLORS.length]
}

export function ChoiceShape({
  index,
  className = 'size-4',
}: {
  index: number
  className?: string
}) {
  const slot = index % CHOICE_COLORS.length

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={CHOICE_SHAPES[slot]}
      className={className}
      fill={CHOICE_COLORS[slot]}
    >
      {slot === 0 && <path d="M12 3.4 21.2 20.6H2.8L12 3.4Z" />}
      {slot === 1 && <path d="M12 2.6 21.4 12 12 21.4 2.6 12 12 2.6Z" />}
      {slot === 2 && <circle cx="12" cy="12" r="9.2" />}
      {slot === 3 && <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.4" />}
    </svg>
  )
}
