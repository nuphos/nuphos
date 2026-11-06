import clsx from 'clsx'
import { Box, Check, ChevronRight, Laptop } from 'lucide-react'

import { t } from '../../../i18n'
import { SHARED_COMPUTER_PRIVACY } from '../../../lib/sharedComputerDisclosure'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeUsageNote } from '../../../views/settings/RuntimeUsageBar'
import { SharedComputerLearnMore } from '../../SharedComputerLearnMore'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'
import { StatusDot } from '../../ui/status-dot'

import { AgentFixChip } from './AgentFixChip'
import { agentAskText, agentFixLabel, agentProblem } from './agentRowFix'
import { adminName } from './agentSignInModel'
import { AgentUpdateBadge } from './AgentUpdateBadge'
import { AgentProviderIcon } from './icons'
import {
  boxAgentName,
  boxWarning,
  selectorMetrics,
  sharedBoxOwner,
  showSharedComputerDisclosure,
} from './selectorBoxes'

import type { SelectorBox } from './selectorBoxes'
import type { PickerFixes } from './usePickerFixes'
import type { AgentDevice } from '../../../api/device-types'
import type { AgentUpdate } from '../../../hooks/useAgentUpdates'
import type { RuntimeQuota } from '../../../types/runtime'
import type { ReactNode } from 'react'

/** Amber from 80%, red from 95%. */
const REVEAL_EASE =
  'duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none'

/**
 * One line at rest; while the row is highlighted the title lifts and the detail
 * rises under it, inside the same height — the sidebar's reveal-in-place.
 */
function RevealLines({ title, detail }: { title: ReactNode; detail: ReactNode }) {
  return (
    <span className="relative block h-9 min-w-0 flex-1 overflow-hidden">
      <span
        className={clsx(
          'flex h-9 min-w-0 items-center gap-1.5 transition-transform',
          REVEAL_EASE,
          detail &&
            'group-data-[highlighted]/row:-translate-y-[7px] group-data-[popup-open]/row:-translate-y-[7px]',
        )}
      >
        {title}
      </span>
      {detail && (
        <span
          className={clsx(
            'pointer-events-none absolute inset-x-0 top-[19px] flex min-w-0 translate-y-1.5 gap-1 truncate text-[11px] text-tertiary opacity-0 transition-[opacity,transform]',
            REVEAL_EASE,
            'group-data-[highlighted]/row:translate-y-0 group-data-[highlighted]/row:opacity-100',
            'group-data-[popup-open]/row:translate-y-0 group-data-[popup-open]/row:opacity-100',
          )}
        >
          {detail}
        </span>
      )}
    </span>
  )
}

/** Whose a teammate's shared computer is, quietly; nothing on the viewer's own. */
function SharedBy({ text }: { text: string | null }) {
  return text && <span className="block truncate text-[11px] text-tertiary">{text}</span>
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
  const warning = boxWarning(metrics)
  const BoxIcon = group.device?.box || !group.agents[0]?.local ? Box : Laptop
  const sharedBy = sharedBoxOwner(group, fixes.viewer.members)

  if (group.unavailable) {
    const problem = group.agents[0] && agentProblem(group.agents[0], undefined, fixes.viewer)
    const busy = problem && fixes.busy(problem.fix)
    const action = problem && agentFixLabel(problem.fix)

    // It can't be picked; the row itself is the fix. At rest it says why, and on
    // hover the same words turn into what a click does, so the row never resizes.
    return (
      <MenuItem
        icon={<BoxIcon className="h-4 w-4 text-tertiary" />}
        closeOnClick={false}
        className="group/offline"
        onClick={() => problem && !busy && fixes.run(problem.fix)}
      >
        {/* The owner goes on its own line, so the computer keeps its name. */}
        <span className="block min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-tertiary">{group.label}</span>
            {current && <Check aria-label={t('Current computer')} className="h-3 w-3 shrink-0" />}
            <span className="shrink-0 text-[11px] text-tertiary">
              ·{' '}
              {busy ? (
                problem?.fix.kind === 'resume' ? (
                  t('Waking…')
                ) : (
                  t('Checking…')
                )
              ) : (
                <>
                  <span className={clsx(action && 'group-data-[highlighted]/offline:hidden')}>
                    {problem?.reason ?? t('Offline')}
                  </span>
                  {action && (
                    <span className="hidden text-secondary group-data-[highlighted]/offline:inline">
                      {t('Click to {action}', { action: action.toLowerCase() })}
                    </span>
                  )}
                </>
              )}
            </span>
          </span>
          <SharedBy text={sharedBy} />
        </span>
      </MenuItem>
    )
  }

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger className="group/row py-0" chevron={<ChevronRight className="h-3 w-3" />}>
        <span className="flex min-w-0 items-center gap-2.5">
          <BoxIcon className="h-4 w-4 shrink-0 text-tertiary" />
          <RevealLines
            title={
              <>
                <span className="truncate font-medium">{group.label}</span>
                {current && (
                  <Check aria-label={t('Current computer')} className="h-3 w-3 shrink-0" />
                )}
              </>
            }
            detail={
              (warning || sharedBy) && (
                <>
                  {warning && <span className="shrink-0 text-status-warning">{warning}</span>}
                  {warning && sharedBy && <span>·</span>}
                  {sharedBy && <span className="truncate">{sharedBy}</span>}
                </>
              )
            }
          />
          {warning && <StatusDot tone="warning" label={warning} />}
        </span>
      </MenuSubmenuTrigger>
      <MenuContent className="w-72">
        <p className="truncate px-2.5 pb-1 pt-2 text-xs font-medium">{group.label}</p>
        {showSharedComputerDisclosure(group) && (
          <p className="px-2.5 py-2 text-[11px] leading-snug text-secondary">
            {SHARED_COMPUTER_PRIVACY} <SharedComputerLearnMore />
          </p>
        )}
        {group.agents.map((instance) => {
          const update = updates.get(instance.id)
          const problem = agentProblem(instance, quotas?.get(instance.id), fixes.viewer)
          const pickable = Boolean(onSelect) && (!problem || problem.pickable)
          const name = boxAgentName(instance)
          const admin = instance.kind === 'managed' && adminName(fixes.viewer.members)
          const askToUpdate = admin && t('Ask {name} to update', { name: admin })
          const provider = AGENT_PROVIDER[instance.provider].label
          // A row that can't take a turn is its fix: no chip, and hover says what a click does.
          const rowFix = problem && !problem.pickable ? problem.fix : null
          const fixLabel = rowFix && rowFix.kind !== 'ask' ? agentFixLabel(rowFix) : null
          const fixAction =
            rowFix &&
            (rowFix.kind === 'ask'
              ? fixes.canAsk(rowFix) && t('Ask to sign in')
              : fixLabel && t('Click to {action}', { action: fixLabel.toLowerCase() }))

          // What can wait for a hover: whose agent it is and what it's doing.
          const detail = [
            name !== provider && provider,
            !rowFix && problem?.reason,
            problem?.fix.kind === 'ask' && agentAskText(problem.fix),
            !problem && update?.state === 'available' && !update.start && askToUpdate,
            instance.deletion && t('Being removed'),
            instance.starting && t('Starting…'),
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <MenuItem
              key={instance.id}
              className="group/row py-0"
              selected={instance.id === selectedId}
              disabled={Boolean(selectDisabled) || Boolean(instance.deletion)}
              icon={<AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />}
              // A row that cannot take a turn starts its fix instead.
              closeOnClick={pickable}
              onClick={() => {
                if (pickable) onSelect?.(instance.id, group.device?.access)
                else if (problem) fixes.run(problem.fix)
              }}
            >
              <RevealLines
                title={
                  <>
                    <span className={clsx('truncate', rowFix && 'text-tertiary')}>{name}</span>
                    {rowFix ? (
                      <span className="shrink-0 text-[11px] text-tertiary">
                        ·{' '}
                        <span className={clsx(fixAction && 'group-data-[highlighted]/row:hidden')}>
                          {problem?.reason ?? t('Unavailable')}
                        </span>
                        {fixAction && (
                          <span className="hidden text-secondary group-data-[highlighted]/row:inline">
                            {fixAction}
                          </span>
                        )}
                      </span>
                    ) : problem ? (
                      <AgentFixChip fix={problem.fix} fixes={fixes} />
                    ) : (
                      update && <AgentUpdateBadge update={update} actionable />
                    )}
                    <span className="text-[11px]">
                      <RuntimeUsageNote quota={quotas?.get(instance.id)} />
                    </span>
                  </>
                }
                detail={detail || null}
              />
            </MenuItem>
          )
        })}
      </MenuContent>
    </MenuSubmenu>
  )
}
