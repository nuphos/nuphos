import { clsx } from 'clsx'
import { ArrowUpRight, ChevronDown, ExternalLink, Link2, MoreVertical } from 'lucide-react'

import { t } from '../../../i18n'
import { copyLinkWithFeedback } from '../../../lib/copyLink'
import { ResourceMark } from '../../sidebar/ResourceMark'
import { resourceStatus } from '../../sidebar/sessionResourcePresentation'
import { resourceStyle } from '../../sidebar/sessionResourceStyle'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { toast } from '../../ui/toast'
import { AgentAvatar } from '../AgentAvatar'

import { changeSubtitle, changeTitle } from './chatSummaryModel'

import type { AgentConversation } from '../../../api/agent-types'
import type { SessionResource } from '../../../api/session-resource-types'
import type { SubAgentState } from '../../../lib/subAgentState'
import type { ReactNode } from 'react'

export { SummarySection } from './SummarySection'

export const sectionClass = 'rounded-xl border border-line-control px-3.5 py-3'
const focusClass =
  'outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-current'
const hoverRowClass =
  '-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-state-hover motion-reduce:transition-none'

export const focusRingClass =
  'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-focus'
const rowFocusClass = `focus-visible:bg-state-hover ${focusRingClass}`

/** What a row shows: an icon, a label and an optional quiet note on the right. */
function SummaryRowBody({
  icon,
  label,
  labelEnd,
  note,
}: {
  icon: ReactNode
  label: string
  labelEnd?: string
  note?: ReactNode
}) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1">
        <span className="truncate">{label}</span>
        {labelEnd && <span className="shrink-0">{labelEnd}</span>}
      </span>
      {note != null && <span className="shrink-0 text-[12px] text-tertiary">{note}</span>}
    </>
  )
}

const rowClass = 'flex h-7 min-w-0 items-center gap-3 text-left text-[13px] text-main'

const rowButtonClass = clsx(rowClass, hoverRowClass, rowFocusClass)

/** A row that opens the menu it sits in, under it; lit while the menu is open. */
/** A Task before its first reply: nothing to list yet. */
export function SummaryEmpty() {
  return (
    <div className="px-1 pt-1 text-[13px] leading-5">
      <p className="text-main">{t('Nothing here yet')}</p>
      <p className="text-tertiary">
        {t('Pull requests, sub-tasks and files from this task appear here after its first reply.')}
      </p>
    </div>
  )
}

export function SummaryMenuRow({
  title,
  className,
  'aria-label': ariaLabel,
  ...body
}: Parameters<typeof SummaryRowBody>[0] & {
  title?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <MenuTrigger
      title={title}
      aria-label={ariaLabel}
      className={clsx(rowButtonClass, 'data-[popup-open]:bg-state-selected', className)}
    >
      <SummaryRowBody {...body} />
    </MenuTrigger>
  )
}

/** A menu row's current choice, cut short when long, with the menu's chevron. */
export function SummaryMenuNote({ children }: { children: ReactNode }) {
  return (
    <span className="flex max-w-36 items-center gap-1">
      <span className="truncate">{children}</span>
      <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.8} />
    </span>
  )
}

/** An icon, a label and an optional quiet note on the right; `labelEnd` never truncates. */
export function SummaryRow({
  onClick,
  title,
  ...body
}: Parameters<typeof SummaryRowBody>[0] & {
  onClick?: () => void
  title?: string
}) {
  const { label, labelEnd } = body

  return onClick ? (
    <button
      type="button"
      title={title ?? `${label}${labelEnd ?? ''}`}
      onClick={onClick}
      className={rowButtonClass}
    >
      <SummaryRowBody {...body} />
    </button>
  ) : (
    <div className={rowClass} title={title ?? label}>
      <SummaryRowBody {...body} />
    </div>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function copyLink(url: string) {
  void copyLinkWithFeedback(url, (text) => navigator.clipboard.writeText(text), {
    onSuccess: () =>
      toast.success(t('Link copied'), undefined, {
        timeoutMs: 1200,
        dedupe: false,
      }),
    onError: () => toast.error(t('Could not copy link'), t('Clipboard was blocked.')),
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
        'group flex min-w-0 items-start gap-3 py-1 focus-within:bg-state-hover',
        hoverRowClass,
      )}
    >
      <span className={clsx('flex size-4 shrink-0 items-center justify-center pt-1', color)}>
        {icon}
      </span>
      <button
        type="button"
        title={`${title} · ${resourceStatus(resource)}`}
        onClick={(event) => onOpen(resource.url, event.metaKey)}
        className={clsx(
          'min-w-0 flex-1 rounded text-left',
          rowFocusClass,
          'focus-visible:bg-transparent',
        )}
      >
        <span className="block truncate text-[13px] leading-5 text-main">{title}</span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] leading-5 text-tertiary">
          <span className="truncate">
            {changeSubtitle(resource)} · {capitalize(resourceStatus(resource))}
          </span>
          <ResourceMark resource={resource} />
        </span>
      </button>
      <Menu>
        <MenuTrigger
          aria-label={t('More actions for {title}', { title })}
          className={clsx(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-state-hover hover:text-main data-[popup-open]:bg-state-selected data-[popup-open]:text-main motion-reduce:transition-none',
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
            {t('Open')}
          </MenuItem>
          <MenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => onOpen(resource.url, true)}
          >
            {t('Open in browser')}
          </MenuItem>
          <MenuItem icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => copyLink(resource.url)}>
            {t('Copy link')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

/** A thread this chat started; running ones say so. */
export function ThreadRow({
  conversation,
  state,
  onOpen,
}: {
  conversation: AgentConversation
  state: SubAgentState
  onOpen: (sessionId: string) => void
}) {
  let note: ReactNode = t('Done')

  if (state === 'waiting') note = <span className="text-warning">{t('Waiting for you')}</span>
  else if (state === 'running')
    note = (
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        {t('Running')}
      </span>
    )

  return (
    <SummaryRow
      icon={
        <AgentAvatar
          agentId={conversation.sessionId}
          avatar={conversation.avatar}
          avatarBackground={conversation.avatarBackground}
          provider={conversation.agentRuntime}
          size={16}
        />
      }
      label={conversation.title || conversation.firstMessage || t('Untitled task')}
      note={note}
      onClick={() => onOpen(conversation.sessionId)}
    />
  )
}
