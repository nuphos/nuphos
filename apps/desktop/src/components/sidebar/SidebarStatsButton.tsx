import { ChartNoAxesColumn } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../i18n'
import { Tooltip } from '../ui/tooltip'

export type SidebarStatsButtonProps = {
  teamId: string
  active: string
  agentSessionId: string | null
  onSelect: (key: string) => void
}

/** Management pages leave the conversation pane mounted underneath. */
export function SidebarStatsButton({
  teamId,
  active,
  agentSessionId,
  onSelect,
}: SidebarStatsButtonProps) {
  const previous = useRef<{ teamId: string; key: string } | null>(null)
  const selected = active === 'team.home'

  return (
    <Tooltip content={t('Stats')}>
      <button
        type="button"
        aria-label={t('Stats')}
        aria-pressed={selected}
        onClick={() => {
          if (selected)
            onSelect(
              previous.current?.teamId === teamId
                ? previous.current.key
                : agentSessionId
                  ? `agent-session:${agentSessionId}`
                  : 'team.agent',
            )
          else {
            previous.current = {
              teamId,
              key: agentSessionId ? `agent-session:${agentSessionId}` : active || 'team.agent',
            }
            onSelect('team.home')
          }
        }}
        className={`titlebar-no-drag flex size-8 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary ${selected ? 'bg-[var(--sidebar-overlay-active)] text-secondary' : ''}`}
      >
        <ChartNoAxesColumn className="size-[15px]" strokeWidth={1.5} />
      </button>
    </Tooltip>
  )
}
