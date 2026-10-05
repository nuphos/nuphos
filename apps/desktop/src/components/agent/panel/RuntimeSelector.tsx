import { ChevronDown, Plus, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentName, agentTier, groupAgentsByTier } from '../../../lib/agentName'
import { quotaDetailLines, quotaSummary, quotaTone } from '../../../lib/runtimeQuota'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { LocalClaudeSignIn } from '../../../views/settings/LocalClaudeSignIn'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui/menu'
import { Tooltip } from '../../ui/tooltip'

import { AgentProviderIcon } from './icons'

import type { QuotaTone } from '../../../lib/runtimeQuota'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

export type RuntimeControl = {
  value: {
    id?: string
    provider: RuntimeInstance['provider']
    label: string
    status?: RuntimeInstance['status']
  } | null
  options?: RuntimeInstance[]
  /** Provider usage of the agent this conversation is bound to. */
  quota?: RuntimeQuota
  /** Provider usage per runtime id, for the list. */
  quotas?: ReadonlyMap<string, RuntimeQuota>
  /** Picks the agent: the one a new conversation starts on, or — for an open
   *  conversation — the one it moves to. */
  onSelect?: (runtimeId: string) => void
  /** Nothing can be picked right now (a turn is streaming, or a move is in flight). */
  selectDisabled?: boolean
  /** The runtime this conversation is bound to is disabled or gone. */
  unavailable?: boolean
  loading?: boolean
  error?: string | null
  onSettings?: () => void
  /** New conversation: add a team agent in place, without leaving the conversation. */
  onAddAgent?: () => void
}

const QUOTA_TONE_CLASS: Record<QuotaTone, string> = {
  ok: 'text-tertiary',
  warning: 'text-warning',
  exhausted: 'text-error',
}

export function QuotaBadge({ quota, prefix = '' }: { quota?: RuntimeQuota; prefix?: string }) {
  const summary = quotaSummary(quota)

  if (!summary) return null
  const lines = quotaDetailLines(quota)

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <span className={`shrink-0 ${QUOTA_TONE_CLASS[quotaTone(quota)]}`}>
        {prefix}
        {summary}
      </span>
    </Tooltip>
  )
}

function runtimeOptionNote(instance: RuntimeInstance): string {
  if (instance.status === 'disabled') return ' · Disabled'
  if (instance.deletion) return ' · Being removed'
  if (instance.starting) return ' · Starting…'
  if (instance.local?.signedIn === false)
    return ` · Sign in to ${AGENT_PROVIDER[instance.provider].label} on that computer`

  return ''
}

export function RuntimeSelector({
  value,
  options = [],
  quota,
  quotas,
  onSelect,
  selectDisabled,
  unavailable,
  loading,
  error,
  onSettings,
  onAddAgent,
}: RuntimeControl) {
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const providerName = AGENT_PROVIDER[value?.provider ?? 'claude-code'].label
  const owner = useThisComputer()
  const selected = value?.id ? options.find((instance) => instance.id === value.id) : undefined
  const label = value
    ? agentName(selected ?? { ...(value.id ? { id: value.id } : {}), label: value.label }, owner)
    : loading
      ? 'Loading agents…'
      : 'Choose agent'
  const selectedQuota = quota ?? (value?.id ? quotas?.get(value.id) : undefined)
  const [usageWaitExpired, setUsageWaitExpired] = useState<string | undefined>()

  useEffect(() => {
    if (!value?.id) return
    const timer = setTimeout(() => setUsageWaitExpired(value.id), 15_000)

    return () => clearTimeout(timer)
  }, [value?.id])
  const usageLoading = Boolean(
    value?.id &&
    usageWaitExpired !== value.id &&
    selected?.status === 'active' &&
    selected.local?.signedIn !== false &&
    (!selectedQuota || selectedQuota.reason === 'That computer has not reported usage yet'),
  )
  const content = (
    <>
      <AgentProviderIcon provider={value?.provider} className="h-3.5 w-3.5 shrink-0" />
      {loading && !value ? (
        <span
          aria-label="Loading agent"
          role="status"
          className="h-3 w-16 rounded bg-zGray-700/60 animate-pulse motion-reduce:animate-none"
        />
      ) : (
        <span className="max-w-40 truncate">{label}</span>
      )}
      {unavailable && <span className="shrink-0 text-amber-400">· Unavailable</span>}
      {usageLoading ? (
        <span
          aria-label="Loading usage"
          role="status"
          className="h-3 w-16 rounded bg-zGray-700/60 animate-pulse motion-reduce:animate-none"
        />
      ) : (
        <QuotaBadge quota={selectedQuota} prefix="· " />
      )}
    </>
  )
  const classes =
    'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 text-[12px] text-secondary'

  if (!onSelect)
    return (
      <span className={classes} title={`${label} · ${providerName}`}>
        {content}
      </span>
    )

  return (
    <>
      {signingIn && (
        <LocalClaudeSignIn
          initiallyOpen
          onClosed={(connected) => {
            if (connected) onSelect(signingIn)
            setSigningIn(null)
          }}
        />
      )}
      <Menu>
        <MenuTrigger
          aria-label={`Conversation agent: ${label}`}
          className={`${classes} transition-colors hover:bg-zGray-800/60 hover:text-main`}
        >
          {content}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </MenuTrigger>
        <MenuContent side="top" align="end" className="w-72">
          {error && <p className="px-2 py-2 text-xs text-error">{error}</p>}
          {!loading && !error && options.length === 0 && (
            <p className="px-2 py-2 text-xs text-tertiary">
              Connect an agent in Settings → Agent to get started.
            </p>
          )}
          <div className="max-h-64 overflow-auto">
            {groupAgentsByTier(options, owner).map((group, index) => (
              <MenuGroup key={group.tier}>
                {index > 0 && <MenuSeparator />}
                <MenuGroupLabel>{group.title}</MenuGroupLabel>
                {group.agents.map((instance) => {
                  const needsLocalLogin =
                    instance.provider === 'claude-code' &&
                    agentTier(instance, owner) === 'local' &&
                    instance.local?.signedIn !== true

                  return (
                    <MenuItem
                      key={instance.id}
                      selected={instance.id === value?.id}
                      disabled={
                        selectDisabled ||
                        instance.status === 'disabled' ||
                        Boolean(instance.deletion) ||
                        (instance.local?.signedIn === false && !needsLocalLogin)
                      }
                      icon={
                        <AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />
                      }
                      onClick={() => {
                        if (needsLocalLogin) setSigningIn(instance.id)
                        else onSelect(instance.id)
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{agentName(instance, owner)}</span>
                        <span className="text-[11px] text-tertiary">
                          {AGENT_PROVIDER[instance.provider].label}
                          {runtimeOptionNote(instance)}
                          <QuotaBadge quota={quotas?.get(instance.id)} prefix=" · " />
                        </span>
                      </span>
                    </MenuItem>
                  )
                })}
              </MenuGroup>
            ))}
          </div>
          {(onAddAgent ?? onSettings) && (
            <>
              {options.length > 0 && <MenuSeparator />}
              {onAddAgent ? (
                <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={onAddAgent}>
                  Add new agent
                </MenuItem>
              ) : (
                <MenuItem icon={<Settings2 className="h-3.5 w-3.5" />} onClick={onSettings}>
                  Manage agents
                </MenuItem>
              )}
            </>
          )}
        </MenuContent>
      </Menu>
    </>
  )
}
