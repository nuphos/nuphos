import clsx from 'clsx'

import { comboText } from '../../lib/platform'

import type { ReactNode } from 'react'

/**
 * A shortcut as plain muted text ('⇧⌘A'), for menu rows and tooltips where a
 * boxed <Kbd> cap would be too heavy. `normal-case tracking-normal` shields it
 * from MenuItem's uppercase hint styling.
 */
export function ShortcutHint({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={clsx('font-sans normal-case tracking-normal text-tertiary', className)}>
      {comboText(combo)}
    </span>
  )
}

/** Tooltip content: the label first, then its shortcut in muted glyphs. */
export function ShortcutLabel({ label, combo }: { label: ReactNode; combo: string }) {
  return (
    <span className="flex items-center justify-between gap-3 whitespace-nowrap">
      <span>{label}</span>
      <ShortcutHint combo={combo} />
    </span>
  )
}
