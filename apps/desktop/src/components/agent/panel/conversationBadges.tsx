import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { Zap } from 'lucide-react'

import { CloudLogo } from '../../CloudLogo'

import type { ConversationActivityBadge } from '../../../lib/conversationActivityBadges'

export function ConversationChannelDot({
  badge,
  avatarSize,
}: {
  badge: ConversationActivityBadge
  avatarSize: number
}) {
  // Sized off the avatar so the pair scales together — the proportions are
  // stated once here rather than as magic numbers that drift apart.
  const size = Math.round(avatarSize * 0.7)

  return (
    <span
      title={badge.description}
      aria-label={badge.description}
      style={{ width: size, height: size }}
      className={clsx(
        // Hung off the corner rather than tucked inside it: the avatar is a
        // face, and covering it to make room for the mark is the wrong trade.
        'absolute -bottom-1 -right-1 flex items-center justify-center rounded-full',
        // White plate + the brand's own colours, the way these marks are meant
        // to be shown; the ring is the pane background so the plate reads as
        // floating above the avatar.
        'border-2 border-[rgb(var(--color-background-base))] bg-white',
      )}
    >
      <CloudLogo provider="slack" size={Math.round(size * 0.6)} />
    </span>
  )
}

export function ConversationActivityBadgeView({ badge }: { badge: ConversationActivityBadge }) {
  const isSlack = badge.kind === 'slack'

  return (
    <span
      title={badge.description}
      aria-label={badge.description}
      className={clsx(
        'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium leading-none',
        isSlack
          ? 'border-[#b36ab9]/35 bg-[#611f69]/15 text-[#d79add]'
          : 'border-zViolet-500/30 bg-zViolet-500/10 text-zViolet-accent',
      )}
    >
      {isSlack ? (
        <FontAwesomeIcon icon={faSlack} className="h-2.5 w-2.5" />
      ) : (
        <Zap className="h-2.5 w-2.5" strokeWidth={2.2} />
      )}
      <span>{badge.label}</span>
    </span>
  )
}
