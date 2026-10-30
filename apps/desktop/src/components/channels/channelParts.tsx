import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, Hash, X } from 'lucide-react'

import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'

import { ROW } from './channelShared'

import type { AgentConversation } from '../../api'
import type { ReactNode } from 'react'

/** A channel's mark: a hash on the quiet surface. */
export function ChannelMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-zGray-800 text-secondary',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Hash style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={2.25} />
    </span>
  )
}

/** A toggle row for one agent, checked when picked. */
export function AgentPickRow({
  agent,
  picked,
  onToggle,
}: {
  agent: Pick<AgentConversation, 'sessionId' | 'title' | 'avatar' | 'agentRuntime'>
  picked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(ROW, 'w-full text-left hover:bg-zGray-800/40')}
    >
      <AgentAvatar
        agentId={agent.sessionId}
        avatar={agent.avatar}
        provider={agent.agentRuntime}
        size={20}
      />
      <span className="min-w-0 flex-1 truncate text-main">
        {agent.title || t('Untitled agent')}
      </span>
      <span
        className={clsx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          picked ? 'border-zViolet-500 bg-zViolet-500 text-white' : 'border-zGray-600',
        )}
      >
        {picked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
    </button>
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
