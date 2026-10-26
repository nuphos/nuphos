import clsx from 'clsx'
import { Check, ChevronRight, CircleAlert, Loader2, MessagesSquare, Square } from 'lucide-react'

import { AgentAvatar } from '../AgentAvatar'
import { ChatLink } from '../MessageResponse'

import { knownThreadTitle, rememberThreadTitle, threadBadgeInfo } from './threadBadges'
import { useThreadStatus } from './useThreadStatus'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'
import type { ThreadStatus } from './threadStatus'
import type { LucideIcon } from 'lucide-react'

const STATUS: Record<ThreadStatus, { label: string; icon?: LucideIcon; tone: string }> = {
  loading: { label: '', tone: 'text-tertiary' },
  running: { label: 'Running', icon: Loader2, tone: 'text-secondary' },
  waiting: { label: 'Needs input', icon: CircleAlert, tone: 'text-warning' },
  done: { label: 'Done', icon: Check, tone: 'text-success' },
  stopped: { label: 'Stopped', icon: Square, tone: 'text-tertiary' },
  unavailable: { label: 'Unavailable', tone: 'text-tertiary' },
}

const BADGE =
  'group/thread inline-flex max-w-full items-center gap-2 rounded-lg border border-zGray-800 bg-zGray-900/60 px-2 py-1.5 text-[13px] text-main no-underline transition-colors duration-150 motion-reduce:transition-none'
const LINKED =
  'hover:border-zGray-700 hover:bg-zGray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent'

function StatusLabel({ status, pending }: { status: ThreadStatus; pending: boolean }) {
  const {
    label,
    icon: Icon,
    tone,
  } = pending ? { label: 'Starting', icon: Loader2, tone: 'text-secondary' } : STATUS[status]
  const spinning = Icon === Loader2

  if (!label) return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-zGray-700" />

  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 text-[12px]', tone)}>
      {Icon && (
        <Icon
          aria-hidden
          strokeWidth={2.25}
          className={clsx('size-3', spinning && 'animate-spin motion-reduce:animate-none')}
        />
      )}
      {label}
    </span>
  )
}

// A thread this viewer cannot read has nothing to open.
function threadHref(teamId: string | undefined, threadId: string | null, status: ThreadStatus) {
  return teamId && threadId && status !== 'unavailable'
    ? `/teams/${teamId}/agent/${threadId}`
    : null
}

/** A thread the agent started or messaged: its title, whether it is working, one click to open. */
export function ThreadBadge({
  part,
  teamId,
  onOpen,
}: {
  part: ToolPart
  teamId?: string
  onOpen?: OpenLink
}) {
  const info = threadBadgeInfo(part)
  const { title, status, provider } = useThreadStatus(info?.threadId ?? null, teamId)

  if (!info) return null
  rememberThreadTitle(info.threadId, title ?? info.title)
  const known = title ?? info.title ?? knownThreadTitle(info.threadId)
  const name = known ?? (status === 'unavailable' ? 'Agent unavailable' : 'Agent')
  const verb = info.verb === 'started' ? 'Started' : 'Messaged'
  const href = threadHref(teamId, info.threadId, status)
  const body = (
    <>
      {info.threadId ? (
        <AgentAvatar agentId={info.threadId} provider={provider} />
      ) : (
        <MessagesSquare aria-hidden strokeWidth={1.75} className="size-6 shrink-0 text-tertiary" />
      )}
      <span className="min-w-0 max-w-[44ch]">
        <span className="block truncate font-medium leading-5" title={name}>
          {name}
        </span>
        <span className="flex items-center gap-2 text-[12px] leading-4 text-tertiary">
          <span>{verb}</span>
          {(known !== null || status !== 'unavailable') && (
            <StatusLabel status={status} pending={info.pending} />
          )}
        </span>
      </span>
    </>
  )

  return (
    <div className="t-chat-card-in flex min-w-0">
      {href ? (
        <ChatLink
          link={href}
          onLinkClick={onOpen}
          className={clsx(BADGE, LINKED)}
          title={`Open “${name}”`}
        >
          {body}
          <ChevronRight
            aria-hidden
            className="-ml-1 size-3.5 shrink-0 text-tertiary opacity-0 transition-opacity duration-150 group-hover/thread:opacity-100 group-focus-visible/thread:opacity-100 motion-reduce:transition-none"
          />
        </ChatLink>
      ) : (
        <span className={BADGE} aria-busy={info.pending}>
          {body}
        </span>
      )}
    </div>
  )
}
