import clsx from 'clsx'
import { Zap } from 'lucide-react'

import { ACCENT_TEXT, FG_TERTIARY } from './modelControlStyles'

/** The chip's text: ⚡ when fast mode is on, the model, then the effort muted. */
export function ModelChipLabel({
  name,
  level,
  levels,
  choosingEffort,
  fast,
}: {
  name: string
  level: string
  /** Every effort label, so the chip can size itself to the widest. */
  levels: string[]
  /** The effort popover is open: the chip reads "Select effort". */
  choosingEffort: boolean
  fast: boolean
}) {
  // Fast mode shows in the chip, as Codex shows its mode icon.
  const fastIcon = fast && (
    <Zap
      aria-hidden
      size={13}
      strokeWidth={1.8}
      fill="currentColor"
      className={clsx('shrink-0', ACCENT_TEXT)}
    />
  )

  return name ? (
    // The label, "Select effort" and an invisible copy of the label at
    // every level share one cell, so the chip keeps the width of the
    // widest and centers its text, as Codex does.
    <span className="grid min-w-0">
      {levels.map((choice) => (
        <span
          key={choice}
          aria-hidden
          className="invisible col-start-1 row-start-1 flex min-w-0 items-center gap-[4px] whitespace-nowrap"
        >
          {fastIcon}
          <span className="min-w-0 truncate">{name}</span>
          <span className="shrink-0">{choice}</span>
        </span>
      ))}
      <span
        aria-hidden={choosingEffort}
        className={clsx(
          'col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-[4px]',
          choosingEffort && 'invisible',
        )}
      >
        {fastIcon}
        <span className="min-w-0 truncate">{name}</span>
        {level && <span className={clsx('shrink-0 whitespace-nowrap', FG_TERTIARY)}>{level}</span>}
      </span>
      <span
        aria-hidden={!choosingEffort}
        className={clsx(
          'col-start-1 row-start-1 truncate text-center',
          FG_TERTIARY,
          !choosingEffort && 'invisible',
        )}
      >
        Select effort
      </span>
    </span>
  ) : (
    <span
      aria-label="Loading model"
      className="h-3 w-24 animate-pulse rounded bg-zGray-700/60 motion-reduce:animate-none"
    />
  )
}
