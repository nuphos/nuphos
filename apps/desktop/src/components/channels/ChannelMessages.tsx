import clsx from 'clsx'
import { Pause } from 'lucide-react'
import { Fragment, useState } from 'react'

import { t } from '../../i18n'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { runtimeTurnActive } from '../../lib/runtimeExecution'
import { AgentAvatar } from '../agent/AgentAvatar'
import { MessageResponse } from '../agent/MessageResponse'
import { parseMessageMetadata } from '../agent/panel/messageMetadata'
import { formatMessageTimestamp } from '../agent/panel/streamText'
import { Avatar } from '../Avatar'

import type { AgentPersistedMessage, AgentTimelineEvent, ChannelAgent } from '../../api'

function textOf(message: AgentPersistedMessage): string {
  return message.parts
    .flatMap((part) => {
      const { type, text } = part as { type?: unknown; text?: unknown }

      return type === 'text' && typeof text === 'string' ? [text] : []
    })
    .join('\n')
}

function time(message: AgentPersistedMessage, sentAt?: string) {
  const at = Date.parse(sentAt ?? message.createdAt ?? '')

  return Number.isFinite(at) ? formatMessageTimestamp(at) : ''
}

/** Who posted: the sender's id, so consecutive posts from one sender form a run. */
function senderOf(message: AgentPersistedMessage): string | undefined {
  const metadata = parseMessageMetadata(message.metadata)

  return metadata ? (metadata.sourceSessionId ?? metadata.sender.id) : undefined
}

/**
 * One post: yours on the right, everyone else's in a bubble on the left. The
 * first post of a run carries the avatar and name; an agent's open its session.
 */
function ChannelMessage({
  message,
  first,
  fresh,
  ownAgent,
  viewerId,
  teamId,
  onOpenSession,
}: {
  message: AgentPersistedMessage
  first: boolean
  /** Arrived while the channel was open: it springs in. */
  fresh: boolean
  /** The viewer's own agent: its face and name open its session. */
  ownAgent: boolean
  viewerId: string
  teamId: string
  onOpenSession: (sessionId: string) => void
}) {
  const metadata = parseMessageMetadata(message.metadata)
  const text = textOf(message)

  if (!metadata || !text) return null
  const { sender } = metadata
  const when = time(message, metadata.sentAt)
  const agentId = sender.type === 'agent' ? (metadata.sourceSessionId ?? sender.id) : null
  const open = agentId && ownAgent ? () => onOpenSession(agentId) : null
  const body = (
    <MessageResponse teamId={teamId} className="[&_p]:whitespace-pre-wrap">
      {text}
    </MessageResponse>
  )

  if (!agentId && sender.id === viewerId)
    return (
      <div className="flex w-full items-start justify-end gap-2.5">
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
          <div
            className={clsx(
              'user-message-bubble max-w-full rounded-2xl rounded-tr-md px-3.5 py-2 break-words',
              fresh && 't-bubble-in-mine',
            )}
          >
            {body}
          </div>
          <span className="pr-0.5 text-[11px] text-tertiary tabular-nums">{when}</span>
        </div>
        <div className="w-7 shrink-0">
          {first && (
            <Avatar
              src={trustedAvatarURL(sender.avatarURL)}
              name={sender.displayName}
              size={28}
              className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
            />
          )}
        </div>
      </div>
    )

  return (
    <div className="flex w-full items-start gap-2.5">
      <div className="w-7 shrink-0">
        {first &&
          (agentId ? (
            // Your own agent's face and name open its session.
            open ? (
              <button type="button" tabIndex={-1} onClick={open} className="rounded-full">
                <AgentAvatar agentId={agentId} provider={sender.agentRuntime} size={28} />
              </button>
            ) : (
              <AgentAvatar agentId={agentId} provider={sender.agentRuntime} size={28} />
            )
          ) : (
            <Avatar
              src={trustedAvatarURL(sender.avatarURL)}
              name={sender.displayName}
              size={28}
              className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
            />
          ))}
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
        {first && (
          <div className="flex max-w-full items-center gap-2 px-1 text-xs leading-4">
            {open ? (
              <button
                type="button"
                title={t('Open session')}
                onClick={open}
                className="truncate font-medium text-secondary hover:underline"
              >
                {sender.displayName}
              </button>
            ) : (
              <span className="truncate font-medium text-secondary">{sender.displayName}</span>
            )}
            {agentId && (
              <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-tertiary">
                {t('Agent')}
              </span>
            )}
          </div>
        )}
        <div
          className={clsx(
            'max-w-full rounded-2xl rounded-tl-md bg-zGray-800/70 px-3.5 py-2 break-words',
            fresh && 't-bubble-in',
          )}
        >
          {body}
        </div>
        <span className="px-1 text-[11px] text-tertiary tabular-nums">{when}</span>
      </div>
    </div>
  )
}

/**
 * Whether `text` names `title` as a whole word, so "Ops" does not match "stops".
 * Only Latin letters and digits bound a word: CJK runs on without spaces.
 */
function names(text: string, title: string): boolean {
  const escaped = title.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text)
}

/**
 * iMessage-style dots for an agent that is in a turn and was spoken to: the
 * latest post names it, or it is the channel's only agent. Every agent wakes
 * to catch up, but one nobody addressed usually stays silent, so no dots.
 */
function Typing({
  agents,
  last,
}: {
  agents: ChannelAgent[]
  last: AgentPersistedMessage | undefined
}) {
  const states = useAgentRuntimeStates()
  const text = last ? textOf(last).toLowerCase() : ''
  const author = last ? senderOf(last) : undefined
  const busy = agents.filter(
    (agent) =>
      author !== agent.sessionId &&
      (agents.length === 1 || names(text, agent.title)) &&
      runtimeTurnActive(states.get(agent.sessionId)),
  )

  return busy.map((agent) => (
    <div
      key={agent.sessionId}
      className="flex items-end gap-2.5"
      role="status"
      aria-label={t('{name} is thinking', { name: agent.title })}
    >
      <AgentAvatar agentId={agent.sessionId} avatar={agent.avatar} size={28} />
      <div className="t-bubble-in flex items-center gap-1 rounded-2xl rounded-bl-md bg-zGray-800/70 px-3.5 py-3">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="t-typing-dot h-1.5 w-1.5 rounded-full bg-tertiary"
            style={{ animationDelay: `${String(delay)}ms` }}
          />
        ))}
      </div>
    </div>
  ))
}

/** The loop guard stopped agents answering agents: a line on the timeline. */
function Paused({ turns }: { turns: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-zGray-800" />
      <span className="flex items-center gap-1.5 rounded-full border border-zGray-800/60 bg-main px-3 py-1 text-[12px] text-secondary">
        <Pause className="h-3 w-3 text-warning" strokeWidth={2.5} />
        {t(
          'Agents paused after {count} replies to each other. They pick up again when someone posts.',
          {
            count: turns,
          },
        )}
      </span>
      <span className="h-px flex-1 bg-zGray-800" />
    </div>
  )
}

const stamp = (value: string | undefined) => Date.parse(value ?? '') || 0

export function ChannelMessages({
  messages,
  events,
  agents,
  viewerId,
  teamId,
  onOpenSession,
}: {
  messages: AgentPersistedMessage[]
  events: AgentTimelineEvent[]
  agents: ChannelAgent[]
  viewerId: string
  teamId: string
  onOpenSession: (sessionId: string) => void
}) {
  // What was here on opening stays put; only posts that arrive later spring in.
  const owned = new Set(
    agents.filter((agent) => agent.ownerId === viewerId).map((agent) => agent.sessionId),
  )
  const [initial] = useState(() => new Set(messages.map((message) => message.id)))
  // Posts and timeline lines in the order they happened.
  const rows = [
    ...messages.map((message, i) => ({
      at: stamp(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt),
      key: message.id,
      node: (
        <ChannelMessage
          message={message}
          first={i === 0 || senderOf(messages[i - 1]!) !== senderOf(message)}
          fresh={!initial.has(message.id)}
          ownAgent={owned.has(senderOf(message) ?? '')}
          viewerId={viewerId}
          teamId={teamId}
          onOpenSession={onOpenSession}
        />
      ),
    })),
    ...events
      .filter((event) => event.kind === 'agents_paused')
      .map((event) => ({
        at: stamp(event.at),
        key: `event-${event.at}`,
        node: <Paused turns={event.turns ?? 10} />,
      })),
  ].sort((a, b) => a.at - b.at)

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-3">
      {rows.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
      <Typing agents={agents} last={messages.at(-1)} />
    </div>
  )
}
