import clsx from 'clsx'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { useRef, useState } from 'react'

import { AgentAvatar } from '../agent/AgentAvatar'
import { Menu, MenuContent, MenuItem, MenuSeparator } from '../ui/menu'

import { FullHistoryDialog } from './full-history-dialog'
import { historyAge, historyMenuRows } from './historyRows'

import type { ChatLookup, HistoryTimeline } from './historyRows'

/**
 * Back and Forward, browser style: a press steps once, a right-click lists the
 * five nearest places that way plus the full history.
 */
export function SidebarHistoryButtons({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  history,
  chatOf = () => undefined,
}: {
  canGoBack: boolean
  canGoForward: boolean
  onBack?: () => void
  onForward?: () => void
  history?: HistoryTimeline
  chatOf?: ChatLookup
}) {
  const [fullOpen, setFullOpen] = useState(false)

  return (
    <div className="titlebar-no-drag flex items-center gap-1.5">
      <HistoryButton
        direction={-1}
        enabled={canGoBack}
        onStep={onBack}
        history={history}
        chatOf={chatOf}
        onShowAll={() => setFullOpen(true)}
      />
      <HistoryButton
        direction={1}
        enabled={canGoForward}
        onStep={onForward}
        history={history}
        chatOf={chatOf}
        onShowAll={() => setFullOpen(true)}
      />
      {history && (
        <FullHistoryDialog
          open={fullOpen}
          onOpenChange={setFullOpen}
          history={history}
          chatOf={chatOf}
        />
      )}
    </div>
  )
}

function HistoryButton({
  direction,
  enabled,
  onStep,
  history,
  chatOf,
  onShowAll,
}: {
  direction: -1 | 1
  enabled: boolean
  onStep?: () => void
  history?: HistoryTimeline
  chatOf: ChatLookup
  onShowAll: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const rows = menuOpen && history ? historyMenuRows(history, direction, chatOf) : []
  const label = direction === -1 ? 'Back' : 'Forward'
  const Icon = direction === -1 ? ChevronLeft : ChevronRight

  return (
    <>
      <button
        ref={ref}
        type="button"
        // Navigate on press, not on release — same reasoning as the tab
        // strip: waiting for `click` adds the held mouse button to the
        // perceived latency. Keyboard activation arrives as detail-0 click.
        onPointerDown={(event) => {
          if (event.button === 0 && !event.ctrlKey && enabled) onStep?.()
        }}
        onClick={(event) => {
          if (event.detail === 0) onStep?.()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          if (enabled && history) setMenuOpen(true)
        }}
        disabled={!enabled}
        className={clsx(
          'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
          enabled
            ? 'text-secondary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]'
            : 'text-tertiary/45 cursor-default',
          menuOpen && 'bg-[var(--sidebar-overlay-hover)] text-main',
        )}
        title={enabled ? `${label} · right-click for history` : label}
        aria-label={label}
        aria-haspopup="menu"
      >
        <Icon className="w-[15px] h-[15px]" />
      </button>
      {history && (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuContent anchor={ref} className="w-[280px]">
            {rows.map((row) => (
              <MenuItem
                key={row.index}
                icon={
                  'icon' in row ? (
                    <row.icon className="h-3.5 w-3.5" />
                  ) : (
                    <AgentAvatar
                      agentId={row.chat.sessionId}
                      avatar={row.chat.avatar}
                      provider={row.chat.agentRuntime}
                      size={16}
                    />
                  )
                }
                hint={historyAge(row.at)}
                onClick={() => history.onJump(row.index)}
              >
                <span className="block truncate">{row.label}</span>
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<History className="h-3.5 w-3.5" />} onClick={onShowAll}>
              Show full history
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </>
  )
}
