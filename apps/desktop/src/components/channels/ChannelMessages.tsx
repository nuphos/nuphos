import { ExternalLink, Pause } from 'lucide-react'
import { Fragment } from 'react'

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

function OpenSession({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 text-[11px] text-tertiary hover:text-secondary"
    >
      {t('Open session')}
      <ExternalLink className="h-3 w-3" strokeWidth={2} />
    </button>
  )
}

/** One post: yours on the right, a person's on the left, an agent's written out in full. */
function ChannelMessage({
  message,
  viewerId,
  teamId,
  onOpenSession,
}: {
  message: AgentPersistedMessage
  viewerId: string
  teamId: string
  onOpenSession: (sessionId: string) => void
}) {
  const metadata = parseMessageMetadata(message.metadata)
  const text = textOf(message)

  if (!metadata || !text) return null
  const { sender } = metadata
  const when = time(message, metadata.sentAt)

  if (sender.type === 'agent') {
    const agentId = metadata.sourceSessionId ?? sender.id

    return (
      <div className="group/message flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          <AgentAvatar agentId={agentId} provider={sender.agentRuntime} size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-xs leading-4">
            <span className="truncate font-medium text-secondary">{sender.displayName}</span>
            <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-tertiary">
              {t('Agent')}
            </span>
            <span className="text-[11px] text-tertiary tabular-nums">{when}</span>
            <span className="ml-auto opacity-0 group-hover/message:opacity-100">
              <OpenSession onOpen={() => onOpenSession(agentId)} />
            </span>
          </div>
          <div className="mt-1.5">
            <MessageResponse teamId={teamId}>{text}</MessageResponse>
          </div>
        </div>
      </div>
    )
  }
  const mine = sender.id === viewerId
  const avatar = (
    <div className="mt-0.5 shrink-0" aria-hidden="true">
      <Avatar
        src={trustedAvatarURL(sender.avatarURL)}
        name={sender.displayName}
        size={28}
        className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
      />
    </div>
  )

  if (mine)
    return (
      <div className="flex w-full items-start justify-end gap-2.5">
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
          <div className="user-message-bubble max-w-full rounded-2xl rounded-tr-md px-3.5 py-2 break-words">
            <MessageResponse teamId={teamId} className="[&_p]:whitespace-pre-wrap">
              {text}
            </MessageResponse>
          </div>
          <span className="pr-0.5 text-[11px] text-tertiary tabular-nums">{when}</span>
        </div>
        {avatar}
      </div>
    )

  return (
    <div className="flex w-full items-start gap-2.5">
      {avatar}
      <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
        <div className="flex max-w-full items-center gap-2 px-1 text-xs leading-4">
          <span className="truncate font-medium text-secondary">{sender.displayName}</span>
          <span className="text-[11px] text-tertiary tabular-nums">{when}</span>
        </div>
        <div className="max-w-full rounded-2xl rounded-tl-md bg-zGray-800/70 px-3.5 py-2 break-words">
          <MessageResponse teamId={teamId} className="[&_p]:whitespace-pre-wrap">
            {text}
          </MessageResponse>
        </div>
      </div>
    </div>
  )
}

/** Which of the channel's agents are in a turn right now: catching up, or working. */
function Thinking({
  agents,
  onOpenSession,
}: {
  agents: ChannelAgent[]
  onOpenSession: (sessionId: string) => void
}) {
  const states = useAgentRuntimeStates()
  const busy = agents.filter((agent) => runtimeTurnActive(states.get(agent.sessionId)))

  if (busy.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 pl-[38px]">
      {busy.map((agent) => (
        <div key={agent.sessionId} className="flex items-center gap-2 text-[12.5px] text-tertiary">
          <AgentAvatar agentId={agent.sessionId} avatar={agent.avatar} size={18} />
          <span>{t('{name} is thinking', { name: agent.title })}</span>
          <OpenSession onOpen={() => onOpenSession(agent.sessionId)} />
        </div>
      ))}
    </div>
  )
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
  // Posts and timeline lines in the order they happened.
  const rows = [
    ...messages.map((message) => ({
      at: stamp(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt),
      key: message.id,
      node: (
        <ChannelMessage
          message={message}
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
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-3">
      {rows.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
      <Thinking agents={agents} onOpenSession={onOpenSession} />
    </div>
  )
}
