import clsx from 'clsx'
import { CornerUpLeft, X } from 'lucide-react'

import { t } from '../../i18n'
import { showBotAccess } from '../../lib/botDetailsPanel'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Avatar } from '../Avatar'
import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'

import type { AgentMessageReply, ChannelFace } from '../../api'

/**
 * Where a group chat's member faces sit, as the design system draws them in a
 * 36px box: whoever spoke last largest, top left. Each is [left, top, size].
 */
const CHAT_CLUSTER = [
  [0, 0, 24],
  [18, 12, 18],
  [5, 22, 14],
] as const

/**
 * A chat's icon: the one other member's face, or up to three members clustered
 * as in the design system. A chat with nobody else shows its title's initials.
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
  const members = (faces ?? []).slice(0, CHAT_CLUSTER.length)

  if (!members[0])
    return <Avatar name={title} size={size} className={clsx('rounded-full', className)} />
  if (members.length === 1)
    return (
      <span
        aria-hidden="true"
        data-looping={looping || undefined}
        className={clsx('inline-flex shrink-0', className)}
      >
        <Face face={members[0]} size={size} sidebar={sidebar} looping={looping} />
      </span>
    )
  const scale = size / 36

  return (
    <span
      aria-hidden="true"
      data-looping={looping || undefined}
      className={clsx('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {members.map((face, index) => {
        const [left, top, disc] = CHAT_CLUSTER[index].map((value) => value * scale)
        const mask = ringCuts(members.length, index, scale)

        return (
          <span
            key={face.id}
            data-chat-face={face.id}
            className="absolute flex items-center justify-center overflow-hidden rounded-full bg-surface-sunken"
            style={{
              left,
              top,
              width: disc,
              height: disc,
              ...(mask && { maskImage: mask, maskComposite: 'intersect' }),
            }}
          >
            <Face face={face} size={disc} showBadge={false} looping={index === 0 && looping} />
          </span>
        )
      })}
    </span>
  )
}

/**
 * The faces drawn over face `index`, cut out of it with a 2px margin, so each
 * face's ring is whatever lies behind the icon: a row's hover or selection too.
 */
function ringCuts(count: number, index: number, scale: number) {
  const [left, top] = CHAT_CLUSTER[index]
  const cuts = CHAT_CLUSTER.slice(index + 1, count).map(([x, y, size]) => {
    const at = `${String((x + size / 2 - left) * scale)}px ${String((y + size / 2 - top) * scale)}px`
    const radius = (size / 2 + 2) * scale

    return `radial-gradient(circle at ${at}, transparent ${String(radius)}px, #000 ${String(radius + 0.5)}px)`
  })

  return cuts.length ? cuts.join(', ') : undefined
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
      avatarBackground={face.agent.avatarBackground}
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

/** What an empty chat shows before its first message. */
export function ChannelIntro({ faces, title }: { faces?: ChannelFace[]; title: string }) {
  return (
    <div className="flex flex-col items-start gap-3 pt-10">
      <ChatIcon faces={faces} title={title} size={44} />
      <div className="text-lg font-semibold leading-snug text-main">{title}</div>
      <div className="max-w-[560px] text-[13px] leading-relaxed text-secondary">
        {t(
          'Everyone here sees each message and decides for themselves whether to reply, as in any group chat.',
        )}
      </div>
    </div>
  )
}

/**
 * The post the next one answers, floating just above the composer over the
 * chat's last lines, inset past the faces on both sides. Its tint sits on
 * the sheet's own color, so the chat passing under it does not show through.
 * It names the post's author, then two lines of it. While it shows, the chat
 * keeps its height as bottom room (`data-composer-overlay`), so the newest post stays whole above it.
 */
export function ReplyingBanner({
  reply,
  onCancel,
}: {
  reply: AgentMessageReply
  onCancel: () => void
}) {
  return (
    <div
      data-composer-overlay=""
      className="mx-[2.375rem] flex items-start gap-2 rounded-xl border-l-2 border-line-control py-1.5 pl-3 pr-1 text-xs leading-4 [background:linear-gradient(var(--color-state-hover),var(--color-state-hover)),rgb(var(--color-surface-sheet))]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-medium text-secondary">
          <CornerUpLeft className="h-3 w-3 shrink-0" strokeWidth={2.2} />
          <span className="truncate">{t('Replying to {name}', { name: reply.authorName })}</span>
        </div>
        <div className="line-clamp-2 text-tertiary">{reply.text}</div>
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

/**
 * The last line in the chat of a Bot that has never been given a selection. It
 * says only that the Bot has no computer: with nothing saved, it still reaches
 * the kinds that are team-wide when unset. Choose opens Bot details' Access
 * section. Gone once anything is saved.
 */
export function ChooseAccessBanner({ bot }: { bot: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-state-hover py-1 pl-3 pr-1 text-xs leading-4">
      <div className="min-w-0 flex-1 text-secondary">
        {t("This Bot can't use any computers yet. Choose what it may use.")}
      </div>
      <Button size="sm" variant="secondary" onClick={() => showBotAccess(bot)}>
        {t('Choose')}
      </Button>
    </div>
  )
}
