import { clsx } from 'clsx'
import { ArrowUpRight, ExternalLink, Link2, MoreVertical } from 'lucide-react'

import { t } from '../../../i18n'
import { copyLinkWithFeedback } from '../../../lib/copyLink'
import { chatRowIndicator } from '../../../lib/runtimeExecution'
import { ResourceMark } from '../../sidebar/ResourceMark'
import { resourceStatus } from '../../sidebar/sessionResourcePresentation'
import { resourceStyle } from '../../sidebar/sessionResourceStyle'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { toast } from '../../ui/toast'
import { AgentAvatar } from '../AgentAvatar'

import { changeSubtitle, changeTitle } from './chatSummaryModel'

import type { AgentConversation } from '../../../api/agent-types'
import type { SessionResource } from '../../../api/session-resource-types'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { ReactNode, Ref } from 'react'

export const sectionClass = 'rounded-xl border border-zGray-800 px-3.5 py-3'
const focusClass =
  'outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-current'
const hoverRowClass =
  '-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-zGray-800/50 motion-reduce:transition-none'

export const focusRingClass =
  'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zViolet-500/70'
const rowFocusClass = `focus-visible:bg-zGray-800/50 ${focusRingClass}`

/** A titled block of rows; `header` sits under the title, above the rows. */
export function SummarySection({
  title,
  header,
  ref,
  children,
}: {
  title: string
  header?: ReactNode
  ref?: Ref<HTMLElement>
  children: ReactNode
}) {
  return (
    <section ref={ref} className={sectionClass} aria-label={title}>
      <h3 className="text-[13px] font-medium text-main">{title}</h3>
      {header}
      <div className="flex flex-col gap-0.5 pt-2">{children}</div>
    </section>
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
    onSuccess: () => toast.success(t('Link copied'), undefined, { timeoutMs: 1200, dedupe: false }),
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
        'group flex min-w-0 items-start gap-3 py-1 focus-within:bg-zGray-800/50',
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
  runtimeState,
  onOpen,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
  onOpen: (sessionId: string) => void
}) {
  // The list that listed this thread published its state to the shared store.
  const indicator = chatRowIndicator(runtimeState, false)
  const running = indicator === 'turn' || indicator === 'background'
  let note: ReactNode = t('Done')

  if (conversation.pendingDecision) note = <span className="text-warning">Waiting for you</span>
  else if (running)
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
          provider={conversation.agentRuntime}
          size={16}
        />
      }
      label={conversation.title || conversation.firstMessage || t('Untitled agent')}
      note={note}
      onClick={() => onOpen(conversation.sessionId)}
    />
  )
}
