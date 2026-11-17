import clsx from 'clsx'

import type { LucideIcon, LucideProps } from 'lucide-react'

/** UI glyphs share the outline weight; provider marks use their own components. */
export function UiIcon({
  icon: Icon,
  size = 14,
  spin = false,
  className,
  title,
  ...props
}: LucideProps & { icon: LucideIcon; spin?: boolean; title?: string }) {
  const label = props['aria-label'] ?? title

  return (
    <Icon
      size={size}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
      className={clsx('shrink-0', spin && 'animate-spin', className)}
      strokeWidth={1.8}
    >
      {title && <title>{title}</title>}
    </Icon>
  )
}
