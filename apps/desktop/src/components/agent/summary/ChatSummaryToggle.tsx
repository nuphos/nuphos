import { useEffect } from 'react'

import {
  toggleChatSummary,
  isChatSummaryShortcut,
  useChatSummaryOpen,
} from '../../../lib/chatSummaryPanel'
import { isMac } from '../../../lib/platform'
import { Kbd } from '../../ui/kbd'
import { Tooltip } from '../../ui/tooltip'

export function SummaryIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="4.5" cy="11.5" r="2" />
      <path d="M9 4.5h5M9 11.5h5" />
    </svg>
  )
}

/**
 * Titlebar button for the chat summary panel. The open state is the window's,
 * so only the focused pane answers ⌘I. A narrow pane hides the button (the ⋯
 * menu offers it instead) but keeps the shortcut.
 */
export function ChatSummaryToggle({
  active,
  hidden = false,
}: {
  active: boolean
  hidden?: boolean
}) {
  const open = useChatSummaryOpen()

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isChatSummaryShortcut(event, isMac)) return
      event.preventDefault()
      toggleChatSummary()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  if (hidden) return null

  return (
    <Tooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          Toggle agent summary
          <Kbd combo="mod+i" />
        </span>
      }
    >
      <button
        type="button"
        aria-label="Toggle agent summary"
        aria-pressed={open}
        onClick={toggleChatSummary}
        className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main aria-pressed:bg-zGray-800/60 aria-pressed:text-main motion-reduce:transition-none"
      >
        <SummaryIcon />
      </button>
    </Tooltip>
  )
}
