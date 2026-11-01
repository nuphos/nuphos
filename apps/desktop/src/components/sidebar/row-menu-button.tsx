import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../i18n'

import { opensRowMenu, rowMenuAnchor } from './row-menu'

import type { KeyboardEvent, MouseEvent } from 'react'

/**
 * A row's More button. It opens the same menu as a right-click on the row, so
 * a stray click shows the row's actions instead of running one.
 */
export function RowMenuButton({ title }: { title: string }) {
  // Open until focus comes back: the menu returns focus here when it closes.
  const [open, setOpen] = useState(false)

  return (
    <span
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t('More actions for {title}', { title })}
      title={t('More actions')}
      onFocus={() => setOpen(false)}
      onClick={(event) => {
        setOpen(true)
        openRowMenu(event)
      }}
      onKeyDown={(event) => {
        if (!opensRowMenu(event.key)) return
        event.preventDefault()
        setOpen(true)
        openRowMenu(event)
      }}
      className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-tertiary outline-none hover:text-main hover:bg-[var(--sidebar-overlay-hover)] focus-visible:text-main focus-visible:bg-[var(--sidebar-overlay-hover)]"
    >
      <MoreHorizontal className="w-3.5 h-3.5" strokeWidth={1.8} />
    </span>
  )
}

// The row owns the menu; ask for it the way a right-click (or ⇧F10) does.
function openRowMenu(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
  event.stopPropagation()
  const button = event.currentTarget
  const init = { bubbles: true, ...rowMenuAnchor(button.getBoundingClientRect()) }

  button.dispatchEvent(new window.MouseEvent('contextmenu', init))
}
