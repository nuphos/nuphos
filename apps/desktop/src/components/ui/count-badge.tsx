import clsx from 'clsx'

export type CountBadgeSize = 'sm' | 'md'

const sizeClasses: Record<CountBadgeSize, string> = {
  // Pinned to the corner of an icon button.
  sm: 'h-4 min-w-4 px-1 text-[10px] font-semibold',
  // Inline at the end of a row.
  md: 'h-5 min-w-5 px-1 text-[11px] font-medium',
}

/**
 * How many things wait on the person. It uses the attention pigment, the one
 * reserved for "needs you", so every such count reads the same across the app.
 */
export function CountBadge({
  count,
  size = 'md',
  label,
  id,
  className,
}: {
  count: number
  size?: CountBadgeSize
  /** Names the count for assistive technology when the number alone is unclear. */
  label?: string
  id?: string
  className?: string
}) {
  return (
    <span
      id={id}
      aria-label={label}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-status-attention leading-none tabular-nums text-inverse',
        sizeClasses[size],
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
