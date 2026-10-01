import clsx from 'clsx'

import { comboParts } from '../../lib/platform'

type KbdProps = {
  /** Combo in 'mod+shift+t' form; 'mod' renders as ⌘ on macOS and Ctrl elsewhere. */
  combo: string
  className?: string
}

/**
 * A key-cap hint for menus, tooltips and the shortcuts cheat sheet. Styling
 * follows the composer's Tab-suggestion cap (composerControls.tsx); `normal-case
 * tracking-normal` shields it from container text styling like MenuItem's
 * uppercase hint slot.
 */
export function Kbd({ combo, className }: KbdProps) {
  return (
    <kbd
      className={clsx(
        'inline-flex flex-shrink-0 items-center gap-0.5 rounded border border-zGray-700 px-1 py-px',
        'font-sans text-[10px] normal-case leading-4 tracking-normal text-tertiary',
        className,
      )}
    >
      {comboParts(combo).map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </kbd>
  )
}
