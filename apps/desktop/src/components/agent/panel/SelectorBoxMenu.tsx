import clsx from 'clsx'
import { Box, Check, ChevronRight, Laptop, LogIn } from 'lucide-react'

import { t } from '../../../i18n'
import { SHARED_COMPUTER_PRIVACY } from '../../../lib/sharedComputerDisclosure'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeUsageBar } from '../../../views/settings/RuntimeUsageBar'
import { SharedComputerLearnMore } from '../../SharedComputerLearnMore'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import { AgentFixChip } from './AgentFixChip'
import { agentAskText, agentProblem } from './agentRowFix'
import { adminName } from './agentSignInModel'
import { AgentUpdateBadge } from './AgentUpdateBadge'
import { AgentProviderIcon } from './icons'
import {
  boxAgentName,
  selectorMetrics,
  sharedBoxOwner,
  showSharedComputerDisclosure,
  signInChoices,
} from './selectorBoxes'

import type { SelectorBox, SelectorMetrics } from './selectorBoxes'
import type { PickerFixes } from './usePickerFixes'
import type { AgentDevice } from '../../../api/device-types'
import type { AgentUpdate } from '../../../hooks/useAgentUpdates'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

/** Amber from 80%, red from 95%. */
function meterTone(value: number) {
  if (value >= 95) return { bar: 'bg-error', text: 'text-error' }
  if (value >= 80) return { bar: 'bg-warning', text: 'text-warning' }

  return { bar: 'bg-action-primary/90', text: 'text-secondary' }
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
          aria-label={t('{label} usage', { label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={t('{percent} used', { percent: percent(value) })}
        >
          <span className="flex justify-between gap-1 text-[10px] text-tertiary">
            <span>{label}</span>
            <span className={clsx('text-[11px] tabular-nums', meterTone(value).text)}>
              {percent(value)}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-state-selected">
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

/** Whose a teammate's shared computer is, quietly; nothing on the viewer's own. */
function SharedBy({ text }: { text: string | null }) {
  return text && <span className="block truncate text-[11px] text-tertiary">{text}</span>
}

/** One agent: picks it, or starts its fix when it cannot take a turn. */
function AgentRow({
  instance,
  selectedId,
  access,
  quotas,
  updates,
  fixes,
  selectDisabled,
  onSelect,
}: {
  instance: RuntimeInstance
  selectedId?: string
  access?: AgentDevice['access']
  quotas?: ReadonlyMap<string, RuntimeQuota>
  updates: ReadonlyMap<string, AgentUpdate>
  fixes: PickerFixes
  selectDisabled?: boolean
  onSelect?: (runtimeId: string, access?: AgentDevice['access']) => void
}) {
  const update = updates.get(instance.id)
  const problem = agentProblem(instance, quotas?.get(instance.id), fixes.viewer)
  const pickable = Boolean(onSelect) && (!problem || problem.pickable)
  const name = boxAgentName(instance)
  const admin = instance.kind === 'managed' && adminName(fixes.viewer.members)
  const askToUpdate = admin && t('Ask {name} to update', { name: admin })
  const provider = AGENT_PROVIDER[instance.provider].label

  return (
    <MenuItem
      selected={instance.id === selectedId}
      disabled={Boolean(selectDisabled) || Boolean(instance.deletion)}
      icon={<AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />}
      // A row that cannot take a turn starts its fix instead.
      closeOnClick={pickable}
      onClick={() => {
        if (pickable) onSelect?.(instance.id, access)
        else if (problem) fixes.run(problem.fix)
      }}
    >
      <span className="flex min-w-0 flex-col py-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={clsx('truncate', problem && !problem.pickable && 'text-secondary')}>
            {name}
          </span>
          {problem ? (
            <AgentFixChip fix={problem.fix} fixes={fixes} />
          ) : (
            update && <AgentUpdateBadge update={update} actionable />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-tertiary">
          {/* One line: a long name truncates with the rest instead of wrapping mid-name. */}
          <span className="min-w-0 truncate">
            {[
              name !== provider && provider,
              problem?.reason,
              problem?.fix.kind === 'ask' && agentAskText(problem.fix),
              !problem && update?.state === 'available' && !update.start && askToUpdate,
              instance.deletion && t('Being removed'),
              instance.starting && t('Starting…'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <RuntimeUsageBar quota={quotas?.get(instance.id)} />
        </span>
      </span>
    </MenuItem>
  )
}

/** One computer: its load in the trigger, its runtimes in the submenu. */
export function SelectorBoxMenu({
  group,
  selectedId,
  metricsUnavailable,
  quotas,
  updates,
  fixes,
  selectDisabled,
  onSelect,
}: {
  group: SelectorBox
  selectedId?: string
  metricsUnavailable: boolean
  quotas?: ReadonlyMap<string, RuntimeQuota>
  updates: ReadonlyMap<string, AgentUpdate>
  fixes: PickerFixes
  selectDisabled?: boolean
  /** Absent for a teammate's conversation: the list shows state and fixes, nothing to pick. */
  onSelect?: (runtimeId: string, access?: AgentDevice['access']) => void
}) {
  const current = group.agents.some((agent) => agent.id === selectedId)
  const metrics = metricsUnavailable ? null : selectorMetrics(group.device)
  const BoxIcon = group.device?.box || !group.agents[0]?.local ? Box : Laptop
  const sharedBy = sharedBoxOwner(group, fixes.viewer.members)
  const { listed, signIn } = signInChoices(group.agents, quotas, selectedId)
  const rowProps = {
    selectedId,
    access: group.device?.access,
    quotas,
    updates,
    fixes,
    selectDisabled,
    onSelect,
  }

  if (group.unavailable) {
    const problem = group.agents[0] && agentProblem(group.agents[0], undefined, fixes.viewer)

    return (
      <MenuItem
        icon={<BoxIcon className="h-4 w-4" />}
        closeOnClick={false}
        onClick={() => problem && fixes.run(problem.fix)}
        hint={problem && <AgentFixChip fix={problem.fix} fixes={fixes} />}
      >
        {/* The owner goes on its own line, so the computer keeps its name. */}
        <span className="block min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-secondary">{group.label}</span>
            {current && <Check aria-label={t('Current computer')} className="h-3 w-3 shrink-0" />}
            <span className="shrink-0 text-[11px] text-tertiary">
              · {problem?.reason ?? t('Offline')}
            </span>
          </span>
          <SharedBy text={sharedBy} />
        </span>
      </MenuItem>
    )
  }

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger className="py-3" chevron={<ChevronRight className="h-3 w-3" />}>
        <span className="flex items-start gap-2.5">
          <BoxIcon className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{group.label}</span>
              {current && <Check aria-label={t('Current computer')} className="h-3 w-3 shrink-0" />}
            </span>
            <SharedBy text={sharedBy} />
            {metrics && <SelectorBoxMeters metrics={metrics} />}
          </span>
        </span>
      </MenuSubmenuTrigger>
      <MenuContent className="w-72">
        <p className="truncate px-2.5 pb-1 pt-2 text-xs font-medium">{group.label}</p>
        {metrics && <p className="px-2.5 pb-2 text-[10px] text-tertiary">{metrics.capacity}</p>}
        {showSharedComputerDisclosure(group) && (
          <p className="px-2.5 py-2 text-[11px] leading-snug text-secondary">
            {SHARED_COMPUTER_PRIVACY} <SharedComputerLearnMore />
          </p>
        )}
        {listed.map((instance) => (
          <AgentRow key={instance.id} instance={instance} {...rowProps} />
        ))}
        {signIn.length > 0 && (
          <MenuSubmenu>
            <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
              <span className="flex items-center gap-2 text-secondary">
                <LogIn className="h-3.5 w-3.5" />
                {t('Sign in to another agent…')}
              </span>
            </MenuSubmenuTrigger>
            <MenuContent className="w-72">
              {signIn.map((instance) => (
                <AgentRow key={instance.id} instance={instance} {...rowProps} />
              ))}
            </MenuContent>
          </MenuSubmenu>
        )}
      </MenuContent>
    </MenuSubmenu>
  )
}
