import clsx from 'clsx'
import { ArrowUp, Check, Loader2, RotateCw } from 'lucide-react'

import { t } from '../../../i18n'
import { Tooltip } from '../../ui/tooltip'

import type { AgentUpdate } from '../../../hooks/useAgentUpdates'

const CHIP =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10.5px] font-medium leading-4'
const BADGE = clsx(CHIP, 'border-zViolet-500/30 bg-zViolet-500/10 text-zViolet-400')

/** An agent's pending update. `actionable` turns it into the button that starts it,
 *  for places where clicking it does not also mean something else. */
export function AgentUpdateBadge({
  update,
  actionable = false,
}: {
  update: AgentUpdate
  actionable?: boolean
}) {
  const version = update.version ? `v${update.version}` : null
  const availableText = version
    ? t('{version} is available', { version })
    : t('the latest version is available')
  const updateToText = version
    ? t('Update to {version}', { version })
    : t('Update to the latest version')

  if (update.state === 'updating')
    return (
      <span className={BADGE} role="status">
        <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
        {t('Updating…')}
      </span>
    )
  if (update.state === 'done')
    return (
      <span className={clsx(CHIP, 'border-success/30 bg-success/10 text-success')} role="status">
        <Check aria-hidden className="h-2.5 w-2.5" />
        {version ? t('Updated to {version}', { version }) : t('Updated')}
      </span>
    )
  const { start } = update
  const failed = update.state === 'failed'

  if (!actionable || !start)
    return (
      <Tooltip content={update.reason ?? availableText}>
        <span className={BADGE}>{t('Update available')}</span>
      </Tooltip>
    )

  return (
    <Tooltip content={failed ? (update.reason ?? updateToText) : updateToText}>
      <button
        type="button"
        className={clsx(
          failed ? clsx(CHIP, 'border-error/30 bg-error/10 text-error') : BADGE,
          'cursor-pointer transition-colors',
          failed
            ? 'hover:bg-error/20'
            : 'hover:border-zViolet-400/60 hover:bg-zViolet-500/20 hover:text-zViolet-300',
        )}
        // Inside a menu item: starting the update neither picks this agent nor closes the menu.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          start()
        }}
      >
        {failed ? (
          <RotateCw aria-hidden className="h-2.5 w-2.5" />
        ) : (
          <ArrowUp aria-hidden className="h-2.5 w-2.5" />
        )}
        {failed ? t('Update failed · Retry') : t('Update available')}
      </button>
    </Tooltip>
  )
}
