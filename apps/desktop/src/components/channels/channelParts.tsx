import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { X } from 'lucide-react'

import { t } from '../../i18n'
import { useAgentAppearance } from '../../lib/agentAppearance'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Avatar } from '../Avatar'

import type { ChannelFace } from '../../api'
import type { ReactNode } from 'react'

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
  /** The size an agent's face takes in the sidebar, which follows its density. */
  sidebar?: boolean
  className?: string
}) {
  const { density } = useAgentAppearance()
  const size = sidebar ? (density === 'compact' ? 22 : 30) : given
  const [front, back] = faces ?? []

  if (!front) return <Avatar name={title} size={size} className={clsx('rounded-full', className)} />
  if (!back)
    return (
      <span aria-hidden="true" className={clsx('inline-flex shrink-0', className)}>
        <Face face={front} size={size} />
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

function Face({ face, size }: { face: ChannelFace; size: number }) {
  return face.agent ? (
    <AgentAvatar
      agentId={face.id}
      avatar={face.agent.avatar}
      provider={face.agent.provider}
      size={size}
    />
  ) : (
    <Avatar src={face.avatarURL} name={face.name} size={size} className="rounded-full" />
  )
}

/** The app's popover chrome, as Share uses it. */
export function ChannelPopover({
  trigger,
  title,
  open,
  onOpenChange,
  align = 'end',
  nativeButton = true,
  children,
}: {
  trigger: ReactNode
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: 'start' | 'end'
  /** False when the trigger is not a <button>, as in a sidebar header. */
  nativeButton?: boolean
  children: ReactNode
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger nativeButton={nativeButton} render={trigger as React.ReactElement} />
      <Popover.Portal>
        <Popover.Positioner align={align} sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown w-[320px] rounded-xl border border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: align === 'end' ? 'top right' : 'top left' }}
          >
            <div className="t-share-in flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2 px-1">
                <Popover.Title className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
                  {title}
                </Popover.Title>
                <Popover.Close
                  className="rounded p-0.5 text-tertiary hover:bg-zGray-800/60 hover:text-main"
                  aria-label={t('Close')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </Popover.Close>
              </div>
              {children}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
