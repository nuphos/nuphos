import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, ExternalLink, Link2, MoreVertical } from 'lucide-react'
import { useState } from 'react'

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

const sectionClass = 'rounded-xl border border-zGray-800 px-3.5 py-3'
const rowClass =
  'flex h-7 w-full min-w-0 items-center gap-3 rounded-md text-left text-[13px] text-main'
const actionClass =
  'transition-colors hover:text-main focus-visible:outline focus-visible:outline-1 focus-visible:outline-current motion-reduce:transition-none'

/** A titled, collapsible block; past five rows it shows the rest on request. */
export function SummarySection({ title, rows }: { title: string; rows: ReactNode[] }) {
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)

  return (
    <section className={sectionClass} aria-label={title}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={clsx('flex items-center gap-1 text-[13px] font-medium text-main', actionClass)}
      >
        {title}
        <ChevronDown
          aria-hidden
          className={clsx(
            'size-3.5 text-tertiary transition-transform motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1">
          {all ? rows : rows.slice(0, SHOWN)}
          {rows.length > SHOWN && (
            <button
              type="button"
              onClick={() => setAll((value) => !value)}
              className={clsx('mt-1 self-start text-[13px] text-tertiary', actionClass)}
            >
              {all ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
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

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        sectionClass,
        'flex w-full items-center justify-between text-[13px] hover:bg-zGray-800/40',
        actionClass,
      )}
    >
      {body}
    </button>
  ) : (
    <div className={clsx(sectionClass, 'flex items-center justify-between text-[13px]')}>
      {body}
    </div>
  )
}

/** An icon, a label and an optional quiet note on the right. */
export function SummaryRow({
  icon,
  label,
  note,
  onClick,
  title,
}: {
  icon: ReactNode
  label: string
  note?: ReactNode
  onClick?: () => void
  title?: string
}) {
  const body = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note != null && <span className="shrink-0 text-tertiary">{note}</span>}
    </>
  )

  return onClick ? (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={clsx(rowClass, 'hover:text-main', actionClass)}
    >
      {body}
    </button>
  ) : (
    <div className={rowClass} title={title ?? label}>
      {body}
    </div>
  )
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
    <div className="group flex min-w-0 items-start gap-3 py-1">
      <span className={clsx('flex size-4 shrink-0 items-center justify-center pt-1', color)}>
        {icon}
      </span>
      <button
        type="button"
        title={`${title} · ${resource.state}`}
        onClick={(event) => onOpen(resource.url, event.metaKey)}
        className={clsx('min-w-0 flex-1 text-left', actionClass)}
      >
        <span className="block truncate text-[13px] leading-5 text-main">{title}</span>
        <span className="block truncate text-[12px] leading-5 text-tertiary">
          {changeSubtitle(resource)}
        </span>
      </button>
      <Menu>
        <MenuTrigger
          aria-label={`More actions for ${title}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 motion-reduce:transition-none"
        >
          <MoreVertical aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuContent align="end" className="w-[180px]">
          <MenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => onOpen(resource.url, true)}
          >
            Open in browser
          </MenuItem>
          <MenuItem
            icon={<Link2 className="h-3.5 w-3.5" />}
            onClick={() =>
              void copyLinkWithFeedback(
                resource.url,
                (text) => navigator.clipboard.writeText(text),
                {
                  onSuccess: () =>
                    toast.success('Link copied', undefined, { timeoutMs: 1200, dedupe: false }),
                  onError: () => toast.error('Could not copy link', 'Clipboard was blocked.'),
                },
              )
            }
          >
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
