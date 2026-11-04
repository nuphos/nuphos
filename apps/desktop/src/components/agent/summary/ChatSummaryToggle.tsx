import { PanelRightClose } from 'lucide-react'
import { useEffect } from 'react'

import { usePaneId } from '../../../app/workspace/WorkspacePaneContext'
import { t } from '../../../i18n'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import {
  toggleChatSummary,
  isChatSummaryShortcut,
  useChatSummaryOpen,
} from '../../../lib/chatSummaryPanel'
import { isMac } from '../../../lib/platform'
import { Kbd } from '../../ui/kbd'
import { Tooltip } from '../../ui/tooltip'
import { shellsFromRuntimeState } from '../panel/shells'

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
 * An open question outranks running background work; neither leaves the plain
 * label, which says the click hides the panel while it is open.
 */
function tooltipLabel(pendingCount: number, background: string | null, open: boolean): string {
  if (pendingCount === 1) return t('1 question needs your input')
  if (pendingCount) return t('{count} questions need your input', { count: pendingCount })

  return background ?? (open ? t('Hide agent summary') : t('Toggle agent summary'))
}

/**
 * Titlebar button for the chat summary panel. The open state belongs to this
 * pane, so toggling it leaves other split panes alone, and only the focused
 * pane answers ⌘I. A narrow pane hides the button (the ⋯ menu offers it
 * instead) but keeps the shortcut.
 */
export function ChatSummaryToggle({
  active,
  hidden = false,
  pendingCount = 0,
  sessionId,
}: {
  active: boolean
  hidden?: boolean
  pendingCount?: number
  /** Its background tasks earn a dot in the sidebar row's background color. */
  sessionId?: string
}) {
  const paneId = usePaneId()
  const open = useChatSummaryOpen(paneId)
  const runtimeStates = useAgentRuntimeStates()
  const backgroundCount = sessionId
    ? shellsFromRuntimeState(runtimeStates.get(sessionId)).length
    : 0

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isChatSummaryShortcut(event, isMac)) return
      event.preventDefault()
      toggleChatSummary(paneId)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, paneId])

  if (hidden) return null
  const background =
    backgroundCount === 1
      ? t('1 background task running')
      : t('{count} background tasks running', { count: backgroundCount })

  return (
    <Tooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          {tooltipLabel(pendingCount, backgroundCount > 0 ? background : null, open)}
          <Kbd combo="mod+i" />
        </span>
      }
    >
      <button
        type="button"
        aria-label={t('Toggle agent summary')}
        aria-pressed={open}
        onClick={() => toggleChatSummary(paneId)}
        className="titlebar-no-drag relative ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main aria-pressed:bg-zGray-800/60 aria-pressed:text-main motion-reduce:transition-none"
      >
        {/* While open it reads as the panel's own close, not the pane's X beside it. */}
        {open ? (
          <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <SummaryIcon />
        )}
        {pendingCount > 0 && (
          <span
            aria-label={
              pendingCount === 1
                ? t('1 pending question')
                : t('{count} pending questions', { count: pendingCount })
            }
            className="absolute -right-1.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-semibold leading-4 text-zGray-950"
          >
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
        {pendingCount === 0 && backgroundCount > 0 && (
          <span
            role="img"
            aria-label={background}
            className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning"
          />
        )}
      </button>
    </Tooltip>
  )
}
