import clsx from 'clsx'
import { Rocket, Sparkles, Zap } from 'lucide-react'

/** The chip's text: ⚡ (or a rocket for Ultrafast) when on, the model, then the effort muted. */
export function ModelChipLabel({
  name,
  level,
  levels,
  fast,
  alwaysShowName = false,
}: {
  name: string
  level: string
  /** Every effort label, so the chip can size itself to the widest. */
  levels: string[]
  /** The fast option's value: 'on' (Fast), 'ultrafast', or off. */
  fast?: string
  alwaysShowName?: boolean
}) {
  // Fast mode shows in the chip, as Codex shows its mode icon.
  const FastIcon = fast === 'ultrafast' ? Rocket : fast === 'on' && Zap
  const fastIcon = FastIcon && (
    <FastIcon
      aria-hidden
      size={13}
      strokeWidth={1.8}
      fill="currentColor"
      className="shrink-0 text-status-attention"
    />
  )

  return (
    // The label and an invisible copy of it at every level share one cell,
    // so the chip keeps the width of the widest and centers its text, as Codex does.
    <>
      {!alwaysShowName && (
        <Sparkles aria-hidden size={14} strokeWidth={1.8} className="shrink-0 @[320px]:hidden" />
      )}
      <span className={clsx('min-w-0', alwaysShowName ? 'grid' : 'hidden @[320px]:grid')}>
        {levels.map((choice) => (
          <span
            key={choice}
            aria-hidden
            className="invisible col-start-1 row-start-1 flex min-w-0 items-center gap-1 whitespace-nowrap"
          >
            {fastIcon}
            <span className="min-w-0 truncate">{name}</span>
            <span className="hidden shrink-0 @[440px]:inline">{choice}</span>
          </span>
        ))}
        <span className="col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-1">
          {fastIcon}
          <span
            className={clsx(
              'min-w-0',
              alwaysShowName ? 'whitespace-normal text-left [overflow-wrap:anywhere]' : 'truncate',
            )}
          >
            {name}
          </span>
          {level && (
            <span className="hidden shrink-0 whitespace-nowrap text-tertiary @[440px]:inline">
              {level}
            </span>
          )}
        </span>
      </span>
    </>
  )
}
