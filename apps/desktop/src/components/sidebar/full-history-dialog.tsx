import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'

import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Kbd } from '../ui/kbd'

import { fullHistoryRows, historyAge } from './historyRows'

import type { ChatLookup, HistoryTimeline } from './historyRows'

/**
 * Everything the main pane showed this session, newest first. Keyboard works
 * like ⌘K: arrows move the highlight, Enter jumps, and it opens on the place
 * the user is now so one arrow press reaches either neighbour.
 */
export function FullHistoryDialog({
  open,
  onOpenChange,
  history,
  chatOf,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: HistoryTimeline
  chatOf: ChatLookup
}) {
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const rows = open ? fullHistoryRows(history, chatOf) : []
  const currentRow = Math.max(
    0,
    rows.findIndex((row) => row.current),
  )
  // null = the place the user is now; cleared on close so every open starts there.
  const [selected, setSelected] = useState<number | null>(null)
  const selectedIndex = Math.min(selected ?? currentRow, Math.max(0, rows.length - 1))
  const setOpen = (next: boolean) => {
    if (!next) setSelected(null)
    onOpenChange(next)
  }

  useEffect(() => {
    document
      .getElementById(`${listId}-${String(selectedIndex)}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [listId, selectedIndex])

  const jump = (index: number) => {
    history.onJump(index)
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50 transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(15vh,138px)] pb-6">
          <Dialog.Popup
            initialFocus={listRef}
            className="flex max-h-full w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-main bg-elevated text-main shadow-[0_18px_50px_#00000066] outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-main px-4">
              <Dialog.Title className="text-sm font-medium">{t('History')}</Dialog.Title>
              <span className="text-xs text-secondary">
                {rows.length === 1 ? t('1 place') : t('{n} places', { n: rows.length })}
              </span>
            </div>
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={0}
              aria-label={t('History, newest first')}
              aria-activedescendant={rows.length ? `${listId}-${String(selectedIndex)}` : undefined}
              onKeyDown={(event) => {
                const last = rows.length - 1
                const next =
                  event.key === 'ArrowDown'
                    ? Math.min(last, selectedIndex + 1)
                    : event.key === 'ArrowUp'
                      ? Math.max(0, selectedIndex - 1)
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? last
                          : null

                if (next !== null) {
                  event.preventDefault()
                  setSelected(next)
                } else if (event.key === 'Enter' && rows[selectedIndex]) {
                  event.preventDefault()
                  jump(rows[selectedIndex].index)
                }
              }}
              className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2 outline-none"
            >
              {rows.map((row, position) => (
                <div
                  key={row.index}
                  id={`${listId}-${String(position)}`}
                  role="option"
                  aria-selected={position === selectedIndex}
                  aria-current={row.current ? 'page' : undefined}
                  onMouseMove={() => setSelected(position)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => jump(row.index)}
                  className={clsx(
                    'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2',
                    position === selectedIndex ? 'bg-zGray-750' : 'hover:bg-zGray-800',
                  )}
                >
                  {'icon' in row ? (
                    <row.icon size={16} className="shrink-0 text-secondary" />
                  ) : (
                    <AgentAvatar
                      agentId={row.chat.sessionId}
                      avatar={row.chat.avatar}
                      provider={row.chat.agentRuntime}
                      size={20}
                    />
                  )}
                  <span
                    className={clsx(
                      'min-w-0 flex-1 truncate text-[13px] text-main',
                      row.current && 'font-medium',
                    )}
                  >
                    {row.label}
                  </span>
                  {row.current ? (
                    <span className="shrink-0 rounded bg-zViolet-500/15 px-1.5 py-0.5 text-[11px] text-main">
                      {t('You are here')}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-secondary">{historyAge(row.at)}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-2 border-t border-main px-4 text-[11px] text-secondary">
              <span>{t('Navigate')}</span>
              <Kbd combo="up" />
              <Kbd combo="down" />
              <span className="ml-2">{t('Go there')}</span>
              <Kbd combo="enter" />
              <span className="flex-1" />
              <Dialog.Close
                aria-label={t('Close history')}
                className="flex items-center gap-2 rounded hover:text-main focus-visible:outline focus-visible:outline-2"
              >
                <span>{t('Close')}</span>
                <Kbd combo="esc" />
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
