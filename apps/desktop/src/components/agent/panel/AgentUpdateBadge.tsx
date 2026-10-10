import clsx from 'clsx'
import { ArrowUp, Loader2 } from 'lucide-react'

import { Tooltip } from '../../ui/tooltip'

import type { AgentUpdate } from '../../../hooks/useAgentUpdates'

const BADGE =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-zViolet-500/30 bg-zViolet-500/10 px-1.5 py-px text-[10.5px] font-medium leading-4 text-zViolet-400'

/** An agent's pending update. `actionable` turns it into the button that starts it,
 *  for places where clicking it does not also mean something else. */
export function AgentUpdateBadge({
  update,
  actionable = false,
}: {
  update: AgentUpdate
  actionable?: boolean
}) {
  const target = update.version ? `v${update.version}` : 'the latest version'

  if (update.state === 'updating')
    return (
      <span className={BADGE} role="status">
        <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
        Updating…
      </span>
    )
  const { start } = update

  if (!actionable || !start)
    return (
      <Tooltip content={update.reason ?? `${target} is available`}>
        <span className={BADGE}>Update available</span>
      </Tooltip>
    )

  return (
    <Tooltip content={`Update to ${target}`}>
      <button
        type="button"
        className={clsx(
          BADGE,
          'cursor-pointer transition-colors hover:border-zViolet-400/60 hover:bg-zViolet-500/20 hover:text-zViolet-300',
        )}
        // Inside a menu item: starting the update neither picks this agent nor closes the menu.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          start()
        }}
      >
        <ArrowUp aria-hidden className="h-2.5 w-2.5" />
        Update available
      </button>
    </Tooltip>
  )
}
