import clsx from 'clsx'
import { CornerUpLeft, X } from 'lucide-react'

import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Avatar } from '../Avatar'
import { IconButton } from '../ui/icon-button'

import type { AgentMessageReply, ChannelFace } from '../../api'

/**
 * A chat's icon, as iMessage draws one: the one other member's face, or two
 * overlapping, whoever spoke last in front. A chat with nobody else shows its
 * title's initials.
 */
export function ChatIcon({
  faces,
  title,
  size: given = 22,
  sidebar = false,
  className,
}: {
  faces?: ChannelFace[]
  title: string
  size?: number
  /** The size a face takes in the sidebar. */
  sidebar?: boolean
  className?: string
}) {
  const size = sidebar ? 36 : given
  const [front, back] = faces ?? []

  if (!front) return <Avatar name={title} size={size} className={clsx('rounded-full', className)} />
  // A sidebar row shows one clean face: whoever spoke last.
  if (!back || sidebar)
    return (
      <span aria-hidden="true" className={clsx('inline-flex shrink-0', className)}>
        <Face face={front} size={size} sidebar={sidebar} />
      </span>
    )
  const small = Math.round(size * 0.72)

  return (
    <span
      aria-hidden="true"
      className={clsx('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <span className="absolute left-0 top-0">
        <Face face={back} size={small} />
      </span>
      <span className="absolute bottom-0 right-0 rounded-full bg-main p-px">
        <Face face={front} size={small - 2} />
      </span>
    </span>
  )
}

/** A chat's face in its header; until the chat loads, a quiet circle holds its place, not a "?". */
export function ChatHeaderIcon({
  faces,
  title,
  loading,
}: {
  faces?: ChannelFace[]
  title: string
  loading: boolean
}) {
  if (loading)
    return <span aria-hidden="true" className="size-[22px] shrink-0 rounded-full bg-state-hover" />

  return <ChatIcon faces={faces} title={title} size={22} />
}

// A chat shows who is in it, so a Bot wears its bare face: no runtime badge.
function Face({ face, size, sidebar }: { face: ChannelFace; size: number; sidebar?: boolean }) {
  return face.agent ? (
    <AgentAvatar
      agentId={face.id}
      avatar={face.agent.avatar}
      provider={face.agent.provider}
      size={size}
      sidebar={sidebar}
      bare
    />
  ) : (
    <Avatar src={face.avatarURL} name={face.name} size={size} className="rounded-full" />
  )
}

/** The post the next one answers, above the composer, laid out as the composer is: its padding outside, its width inside. */
export function ReplyingBanner({
  reply,
  onCancel,
}: {
  reply: AgentMessageReply
  onCancel: () => void
}) {
  return (
    <div className="px-3">
      <div className="mx-auto mb-1.5 flex max-w-[760px] items-center gap-2 rounded-xl bg-state-hover py-1 pl-3 pr-1 text-xs leading-4">
        <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2.2} />
        <div className="min-w-0 flex-1 truncate text-tertiary">
          <span className="font-medium text-secondary">
            {t('Replying to {name}', { name: reply.authorName })}
          </span>{' '}
          {reply.text}
        </div>
        <IconButton
          size="sm"
          label={t('Cancel reply')}
          shortcut="Esc"
          icon={<X />}
          onClick={onCancel}
        />
      </div>
    </div>
  )
}
