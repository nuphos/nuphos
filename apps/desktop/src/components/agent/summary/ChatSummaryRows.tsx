import { clsx } from 'clsx'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  MoreVertical,
} from 'lucide-react'
import { useState } from 'react'

import { useSectionOpen } from '../../../lib/chatSummaryPanel'
import { copyLinkWithFeedback } from '../../../lib/copyLink'
import { chatRowIndicator } from '../../../lib/runtimeExecution'
import { resourceStyle } from '../../sidebar/sessionResourceStyle'
import { useRuntimeObservation } from '../../sidebar/useRuntimeObservation'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { toast } from '../../ui/toast'
import { AgentProviderIcon } from '../panel/icons'

import { changeSubtitle, changeTitle } from './chatSummaryModel'

import type { AgentConversation } from '../../../api/agent-types'
import type { SessionResource } from '../../../api/session-resource-types'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { ReactNode } from 'react'

const SHOWN = 5

export const sectionClass = 'rounded-xl border border-zGray-800 px-3.5 py-3'
const focusClass =
  'outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-current'
const hoverRowClass =
  '-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-zGray-800/50 motion-reduce:transition-none'
// Rows sit in a clipped, collapsible box, so their focus ring is drawn inside them.
const rowFocusClass =
  'outline-none focus-visible:bg-zGray-800/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zViolet-500/70'

/** A titled block that collapses (remembered per window); past five rows it offers the rest. */
export function SummarySection({ title, rows }: { title: string; rows: ReactNode[] }) {
  const [open, toggle] = useSectionOpen(title)
  const [all, setAll] = useState(false)
  const hidden = rows.length - SHOWN

  return (
    <section className={sectionClass} aria-label={title}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={clsx(
          'flex items-center gap-1 rounded text-[13px] font-medium text-main',
          focusClass,
        )}
      >
        {title}
        <ChevronDown
          aria-hidden
          className={clsx(
            'size-3.5 text-tertiary transition-transform duration-200 motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
      <div
        inert={!open}
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="-mx-1.5 min-h-0 overflow-hidden px-1.5">
          <div className="flex flex-col gap-0.5 py-0.5 pt-2">
            {all ? rows : rows.slice(0, SHOWN)}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setAll((value) => !value)}
                className={clsx(
                  'mt-1 self-start rounded text-[13px] text-tertiary transition-colors hover:text-main',
                  focusClass,
                )}
              >
                {all ? 'Show less' : `Show ${String(hidden)} more`}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** A one-line block that opens something else, its count on the right. */
export function SummaryLink({
  title,
  value,
  onClick,
}: {
  title: string
  value: string
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="flex items-center gap-1 font-medium text-main">
        {title}
        {onClick && <ChevronRight aria-hidden className="size-3.5 text-tertiary" />}
      </span>
      <span className="text-tertiary">{value}</span>
    </>
  )
  const layout = 'flex w-full items-center justify-between text-[13px]'

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={clsx(sectionClass, layout, 'transition-colors hover:bg-zGray-800/40', focusClass)}
    >
      {body}
    </button>
  ) : (
    <div className={clsx(sectionClass, layout)}>{body}</div>
  )
}

/** An icon, a label and an optional quiet note on the right; `labelEnd` never truncates. */
export function SummaryRow({
  icon,
  label,
  labelEnd,
  note,
  onClick,
  title,
}: {
  icon: ReactNode
  label: string
  labelEnd?: string
  note?: ReactNode
  onClick?: () => void
  title?: string
}) {
  const body = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1">
        <span className="truncate">{label}</span>
        {labelEnd && <span className="shrink-0">{labelEnd}</span>}
      </span>
      {note != null && <span className="shrink-0 text-[12px] text-tertiary">{note}</span>}
    </>
  )
  const rowClass = 'flex h-7 min-w-0 items-center gap-3 text-left text-[13px] text-main'

  return onClick ? (
    <button
      type="button"
      title={title ?? `${label}${labelEnd ?? ''}`}
      onClick={onClick}
      className={clsx(rowClass, hoverRowClass, rowFocusClass)}
    >
      {body}
    </button>
  ) : (
    <div className={rowClass} title={title ?? label}>
      {body}
    </div>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function copyLink(url: string) {
  void copyLinkWithFeedback(url, (text) => navigator.clipboard.writeText(text), {
    onSuccess: () => toast.success('Link copied', undefined, { timeoutMs: 1200, dedupe: false }),
    onError: () => toast.error('Could not copy link', 'Clipboard was blocked.'),
  })
}

/** A pull request or issue: state icon, title, where it lives, and its menu. */
export function ChangeRow({
  resource,
  onOpen,
}: {
  resource: SessionResource
  onOpen: (url: string, external: boolean) => void
}) {
  const { icon, color } = resourceStyle(resource)
  const title = changeTitle(resource)

  return (
    <div
      className={clsx(
        'group flex min-w-0 items-start gap-3 py-1 focus-within:bg-zGray-800/50',
        hoverRowClass,
      )}
    >
      <span className={clsx('flex size-4 shrink-0 items-center justify-center pt-1', color)}>
        {icon}
      </span>
      <button
        type="button"
        title={`${title} · ${resource.state}`}
        onClick={(event) => onOpen(resource.url, event.metaKey)}
        className={clsx(
          'min-w-0 flex-1 rounded text-left',
          rowFocusClass,
          'focus-visible:bg-transparent',
        )}
      >
        <span className="block truncate text-[13px] leading-5 text-main">{title}</span>
        <span className="block truncate text-[12px] leading-5 text-tertiary">
          {changeSubtitle(resource)} · {capitalize(resource.state)}
        </span>
      </button>
      <Menu>
        <MenuTrigger
          aria-label={`More actions for ${title}`}
          className={clsx(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/80 hover:text-main data-[popup-open]:bg-zGray-800/80 data-[popup-open]:text-main motion-reduce:transition-none',
            focusClass,
          )}
        >
          <MoreVertical aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuContent align="end" className="w-[180px]">
          <MenuItem
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
            onClick={() => onOpen(resource.url, false)}
          >
            Open
          </MenuItem>
          <MenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => onOpen(resource.url, true)}
          >
            Open in browser
          </MenuItem>
          <MenuItem icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => copyLink(resource.url)}>
            Copy link
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

/** A thread this chat started; running ones say so. */
export function ThreadRow({
  conversation,
  runtimeState,
  onOpen,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
  onOpen: (sessionId: string) => void
}) {
  const indicator = chatRowIndicator(useRuntimeObservation(conversation, runtimeState), false)
  const running = indicator === 'turn' || indicator === 'background'

  return (
    <SummaryRow
      icon={<AgentProviderIcon provider={conversation.agentRuntime} className="size-3.5" />}
      label={conversation.title || conversation.firstMessage || 'Untitled chat'}
      note={
        running ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Running
          </span>
        ) : (
          'Done'
        )
      }
      onClick={() => onOpen(conversation.sessionId)}
    />
  )
}
