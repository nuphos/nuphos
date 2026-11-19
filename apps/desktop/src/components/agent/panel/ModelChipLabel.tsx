import { Rocket, Sparkles, Zap } from 'lucide-react'

import { t } from '../../../i18n'

/** The chip's text: ⚡ (or a rocket for Ultrafast) when on, the model, then the effort muted. */
export function ModelChipLabel({
  name,
  loading,
  level,
  levels,
  fast,
}: {
  name: string
  loading: boolean
  level: string
  /** Every effort label, so the chip can size itself to the widest. */
  levels: string[]
  /** The fast option's value: 'on' (Fast), 'ultrafast', or off. */
  fast?: string
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

  return loading ? (
    <span
      aria-label={t('Loading model')}
      className="h-3 w-24 animate-pulse rounded bg-state-selected motion-reduce:animate-none"
    />
  ) : (
    // The label and an invisible copy of it at every level share one cell,
    // so the chip keeps the width of the widest and centers its text, as Codex does.
    <>
      <Sparkles aria-hidden size={14} strokeWidth={1.8} className="shrink-0 @[320px]:hidden" />
      <span className="hidden min-w-0 @[320px]:grid">
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
          <span className="min-w-0 truncate">{name}</span>
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
