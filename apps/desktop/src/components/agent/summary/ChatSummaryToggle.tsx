import { useEffect } from 'react'

import { usePaneId } from '../../../app/workspace/WorkspacePaneContext'
import { t } from '../../../i18n'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { toggleChatSummary, useChatSummaryOpen } from '../../../lib/chatSummaryPanel'
import { isChatSummaryShortcut } from '../../../lib/chatSummaryShortcut'
import { isMac } from '../../../lib/platform'
import { useSessionTerminalProcesses } from '../../../lib/sessionTerminalProcesses'
import { CountBadge } from '../../ui/count-badge'
import { Kbd } from '../../ui/kbd'
import { StatusDot } from '../../ui/status-dot'
import { Tooltip } from '../../ui/tooltip'
import { shellsFromRuntimeState } from '../panel/shells'

import { backgroundLabel } from './backgroundLabel'

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

  return background ?? (open ? t('Hide task summary') : t('Toggle task summary'))
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
  /** Its background tasks and busy dock terminals earn a dot in the sidebar row's background color. */
  sessionId?: string
}) {
  const paneId = usePaneId()
  const open = useChatSummaryOpen(paneId)
  const runtimeStates = useAgentRuntimeStates()
  const taskCount = sessionId ? shellsFromRuntimeState(runtimeStates.get(sessionId)).length : 0
  const terminalCount = useSessionTerminalProcesses(sessionId ?? '').length
  const backgroundCount = taskCount + terminalCount

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
  const background = backgroundLabel(taskCount, terminalCount)

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
        aria-label={t('Toggle task summary')}
        aria-pressed={open}
        onClick={() => toggleChatSummary(paneId)}
        className="titlebar-no-drag relative ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-state-hover hover:text-main aria-pressed:bg-state-selected aria-pressed:text-main motion-reduce:transition-none"
      >
        {/* One icon either way: the pressed background already says it is open. */}
        <SummaryIcon />
        {pendingCount > 0 && (
          <CountBadge
            size="sm"
            count={pendingCount}
            label={
              pendingCount === 1
                ? t('1 pending question')
                : t('{count} pending questions', { count: pendingCount })
            }
            className="absolute -right-1.5 -top-1"
          />
        )}
        {pendingCount === 0 && backgroundCount > 0 && (
          <StatusDot tone="warning" label={background} className="absolute right-0.5 top-0.5" />
        )}
      </button>
    </Tooltip>
  )
}
