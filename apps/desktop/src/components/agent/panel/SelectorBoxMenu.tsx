import clsx from 'clsx'
import { Box, Check, ChevronRight, Laptop } from 'lucide-react'

import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeUsageBar } from '../../../views/settings/RuntimeUsageBar'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import { AgentUpdateBadge } from './AgentUpdateBadge'
import { AgentProviderIcon } from './icons'
import { boxAgentName, selectorMetrics } from './selectorBoxes'

import type { SelectorBox, SelectorMetrics } from './selectorBoxes'
import type { AgentUpdate } from '../../../hooks/useAgentUpdates'
import type { RuntimeQuota } from '../../../types/runtime'

/** Amber from 80%, red from 95%. */
function meterTone(value: number) {
  if (value >= 95) return { bar: 'bg-error', text: 'text-error' }
  if (value >= 80) return { bar: 'bg-warning', text: 'text-warning' }

  return { bar: 'bg-zViolet-400', text: 'text-secondary' }
}

function percent(value: number) {
  return `${String(Math.round(value))}%`
}

/** CPU, memory and disk as three labelled bars. */
export function SelectorBoxMeters({ metrics }: { metrics: SelectorMetrics }) {
  const meters = [
    ['CPU', metrics.cpu],
    ['MEM', metrics.memory],
    ['DISK', metrics.disk],
  ] as const

  return (
    <span className="mt-2 grid grid-cols-3 gap-3">
      {meters.map(([label, value]) => (
        <span
          key={label}
          role="meter"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={`${percent(value)} used`}
        >
          <span className="flex justify-between gap-1 text-[10px] text-tertiary">
            <span>{label}</span>
            <span className={clsx('text-[11px] tabular-nums', meterTone(value).text)}>
              {percent(value)}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-zGray-700/40">
            <span
              className={clsx('block h-full rounded-full', meterTone(value).bar)}
              style={{ width: percent(value) }}
            />
          </span>
        </span>
      ))}
    </span>
  )
}

/** One computer: its load in the trigger, its runtimes in the submenu. */
export function SelectorBoxMenu({
  group,
  selectedId,
  metricsUnavailable,
  quotas,
  updates,
  selectDisabled,
  onSelect,
}: {
  group: SelectorBox
  selectedId?: string
  metricsUnavailable: boolean
  quotas?: ReadonlyMap<string, RuntimeQuota>
  updates: ReadonlyMap<string, AgentUpdate>
  selectDisabled?: boolean
  onSelect: (runtimeId: string) => void
}) {
  const current = group.agents.some((agent) => agent.id === selectedId)
  const metrics = metricsUnavailable ? null : selectorMetrics(group.device)
  const BoxIcon = group.device?.box || !group.agents[0]?.local ? Box : Laptop

  if (group.unavailable)
    return (
      <MenuItem disabled icon={<BoxIcon className="h-4 w-4" />} hint={group.unavailable}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{group.label}</span>
          {current && <Check aria-label="Current computer" className="h-3 w-3 shrink-0" />}
        </span>
      </MenuItem>
    )

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger className="py-3" chevron={<ChevronRight className="h-3 w-3" />}>
        <span className="flex items-start gap-2.5">
          <BoxIcon className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{group.label}</span>
              {current && <Check aria-label="Current computer" className="h-3 w-3 shrink-0" />}
            </span>
            {metrics && <SelectorBoxMeters metrics={metrics} />}
          </span>
        </span>
      </MenuSubmenuTrigger>
      <MenuContent className="w-72">
        <p className="truncate px-2.5 pb-1 pt-2 text-xs font-medium">{group.label}</p>
        {metrics && <p className="px-2.5 pb-2 text-[10px] text-tertiary">{metrics.capacity}</p>}
        {group.agents.map((instance) => {
          const update = updates.get(instance.id)
          const name = boxAgentName(instance)
          const provider = AGENT_PROVIDER[instance.provider].label

          return (
            <MenuItem
              key={instance.id}
              selected={instance.id === selectedId}
              disabled={Boolean(selectDisabled) || Boolean(instance.deletion)}
              icon={<AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />}
              onClick={() => onSelect(instance.id)}
            >
              <span className="flex min-w-0 flex-col py-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{name}</span>
                  {update && <AgentUpdateBadge update={update} actionable />}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
                  {name !== provider && provider}
                  {instance.deletion && ' · Being removed'}
                  {instance.starting && ' · Starting…'}
                  <RuntimeUsageBar quota={quotas?.get(instance.id)} />
                </span>
              </span>
            </MenuItem>
          )
        })}
      </MenuContent>
    </MenuSubmenu>
  )
}
