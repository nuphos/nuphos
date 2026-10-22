import clsx from 'clsx'
import { Box, Check, ChevronRight, Laptop } from 'lucide-react'

import { quotaSignedOut } from '../../../lib/runtimeQuota'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeUsageBar } from '../../../views/settings/RuntimeUsageBar'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import { AgentUpdateBadge } from './AgentUpdateBadge'
import { AgentProviderIcon } from './icons'
import { boxAgentName, selectorMetrics, selectorSignIn } from './selectorBoxes'

import type { SelectorBox, SelectorMetrics } from './selectorBoxes'
import type { AgentUpdate } from '../../../hooks/useAgentUpdates'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

const SIGN_IN_LABEL = {
  login: 'Sign in',
  instructions: 'How to sign in',
  none: 'Ask an administrator to sign in',
} as const

/** Amber from 80%, red from 95%. */
function meterTone(value: number | null) {
  if (value === null) return { bar: '', text: 'text-tertiary' }
  if (value >= 95) return { bar: 'bg-error', text: 'text-error' }
  if (value >= 80) return { bar: 'bg-warning', text: 'text-warning' }

  return { bar: 'bg-zViolet-400', text: 'text-secondary' }
}

function percent(value: number) {
  return `${String(Math.round(value))}%`
}

function runtimeOptionNote(instance: RuntimeInstance): string {
  if (instance.deletion) return ' · Being removed'
  if (instance.starting) return ' · Starting…'

  return ''
}

/** CPU, memory and disk as three labelled bars; "—" when there is no live reading. */
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
          aria-valuenow={value ?? undefined}
          aria-valuetext={value === null ? 'Unavailable' : `${percent(value)} used`}
        >
          <span className="flex justify-between gap-1 text-[10px] text-tertiary">
            <span>{label}</span>
            <span className={clsx('text-[11px] tabular-nums', meterTone(value).text)}>
              {value === null ? '—' : percent(value)}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-zGray-700/40">
            {value !== null && (
              <span
                className={clsx('block h-full rounded-full', meterTone(value).bar)}
                style={{ width: percent(value) }}
              />
            )}
          </span>
        </span>
      ))}
    </span>
  )
}

/** One Box: its health in the trigger, its agents in the submenu. */
export function SelectorBoxMenu({
  group,
  selectedId,
  metricsUnavailable,
  quotas,
  updates,
  admin,
  selectDisabled,
  onSelect,
  onSignIn,
  onHowTo,
}: {
  group: SelectorBox
  selectedId?: string
  metricsUnavailable: boolean
  quotas?: ReadonlyMap<string, RuntimeQuota>
  updates: ReadonlyMap<string, AgentUpdate>
  admin: boolean
  selectDisabled?: boolean
  onSelect: (runtimeId: string) => void
  onSignIn: (instance: RuntimeInstance) => void
  onHowTo: (instance: RuntimeInstance) => void
}) {
  const offline =
    group.device?.online === false || group.agents.every((agent) => agent.status !== 'active')
  const current = group.agents.some((agent) => agent.id === selectedId)
  const metrics = selectorMetrics(metricsUnavailable ? undefined : group.device)
  const BoxIcon = group.device?.box || !group.agents[0]?.local ? Box : Laptop

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger className="py-3" chevron={<ChevronRight className="h-3 w-3" />}>
        <span className="flex items-start gap-2.5">
          <BoxIcon className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={clsx(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  offline ? 'bg-tertiary' : 'bg-success',
                )}
              />
              <span className="truncate font-medium">{group.label}</span>
              {current && <Check aria-label="Current Box" className="h-3 w-3 shrink-0" />}
              {offline && <span className="text-[10px] text-tertiary">Offline</span>}
            </span>
            {group.device && <SelectorBoxMeters metrics={metrics} />}
          </span>
        </span>
      </MenuSubmenuTrigger>
      <MenuContent className="w-72">
        <p className="truncate px-2.5 pb-1 pt-2 text-xs font-medium">{group.label}</p>
        {metrics.capacity && (
          <p className="px-2.5 pb-2 text-[10px] text-tertiary">{metrics.capacity}</p>
        )}
        {group.agents.map((instance) => {
          const quota = quotas?.get(instance.id)
          const signedOut = instance.local?.signedIn === false || quotaSignedOut(quota)
          const action = selectorSignIn(instance, group.device, admin)
          const update = updates.get(instance.id)
          const name = boxAgentName(instance)
          const provider = AGENT_PROVIDER[instance.provider].label
          const unusable = offline || instance.status !== 'active' || Boolean(instance.notReady)

          return (
            <MenuItem
              key={instance.id}
              selected={instance.id === selectedId}
              disabled={
                Boolean(selectDisabled) ||
                Boolean(instance.deletion) ||
                (signedOut ? !action || offline : unusable)
              }
              icon={<AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />}
              onClick={() => {
                if (!signedOut) onSelect(instance.id)
                else if (action === 'login') onSignIn(instance)
                else onHowTo(instance)
              }}
            >
              <span className="flex min-w-0 flex-col py-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{name}</span>
                  {update && <AgentUpdateBadge update={update} actionable />}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
                  {name !== provider && provider}
                  {signedOut ? (
                    <span className="text-warning">{SIGN_IN_LABEL[action ?? 'none']}</span>
                  ) : (
                    <>
                      {runtimeOptionNote(instance)}
                      <RuntimeUsageBar quota={quota} />
                    </>
                  )}
                </span>
              </span>
            </MenuItem>
          )
        })}
      </MenuContent>
    </MenuSubmenu>
  )
}
