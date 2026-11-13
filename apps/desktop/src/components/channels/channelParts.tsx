import clsx from 'clsx'
import { CornerUpLeft, X } from 'lucide-react'

import { t } from '../../i18n'
import { AgentAvatar, AgentFaceBadge } from '../agent/AgentAvatar'
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
  looping = false,
  className,
}: {
  faces?: ChannelFace[]
  title: string
  size?: number
  /** The size a face takes in the sidebar. */
  sidebar?: boolean
  /** The face plays its idle loop, as for a running turn (a Bot whose sub-agent works). */
  looping?: boolean
  className?: string
}) {
  const size = sidebar ? 36 : given
  const [front, back] = faces ?? []

  if (!front) return <Avatar name={title} size={size} className={clsx('rounded-full', className)} />
  // A sidebar row shows one clean face: whoever spoke last.
  if (!back || sidebar)
    return (
      <span aria-hidden="true" className={clsx('inline-flex shrink-0', className)}>
        <Face face={front} size={size} sidebar={sidebar} looping={looping} />
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
        <Face face={back} size={small} showBadge={false} />
      </span>
      <span className="absolute bottom-0 right-0 rounded-full bg-main p-px">
        <Face face={front} size={small - 2} showBadge={false} />
      </span>
      {[back, front].map((face, index) => {
        if (!face.agent) return null
        const badge = small <= 24 ? 9 : 12
        // Two discs otherwise intersect at small group sizes. Move only the front
        // disc by the overlap; the faces and the group's layout box stay put.
        const separation = back.agent && front.agent ? Math.max(0, badge - (size - small - 1)) : 0

        return (
          <span
            key={face.id}
            className="absolute pointer-events-none"
            style={
              index === 0
                ? { left: 0, top: 0, width: small, height: small }
                : {
                    right: 1 - separation,
                    bottom: 1 - separation,
                    width: small - 2,
                    height: small - 2,
                  }
            }
          >
            <AgentFaceBadge
              agentId={face.id}
              avatar={face.agent.avatar}
              provider={face.agent.provider}
              size={badge}
            />
          </span>
        )
      })}
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

// Bots keep their runtime badge wherever their face appears.
function Face({
  face,
  size,
  sidebar,
  showBadge = true,
  looping,
}: {
  face: ChannelFace
  size: number
  sidebar?: boolean
  showBadge?: boolean
  looping?: boolean
}) {
  return face.agent ? (
    <AgentAvatar
      agentId={face.id}
      avatar={face.agent.avatar}
      provider={face.agent.provider}
      size={size}
      sidebar={sidebar}
      showBadge={showBadge}
      looping={looping}
    />
  ) : (
    <Avatar src={face.avatarURL} name={face.name} size={size} className="rounded-full" />
  )
}

/** The post the next one answers, above the composer and as wide as it. */
export function ReplyingBanner({
  reply,
  onCancel,
}: {
  reply: AgentMessageReply
  onCancel: () => void
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-state-hover py-1 pl-3 pr-1 text-xs leading-4">
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
  )
}
