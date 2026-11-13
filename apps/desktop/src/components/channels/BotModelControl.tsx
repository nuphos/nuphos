import { useSyncExternalStore } from 'react'

import { t } from '../../i18n'
import { runtimeStateOf, subscribeRuntimeStates } from '../../lib/agentRuntimeStates'
import { runtimeAllows } from '../../lib/runtimeExecution'
import { AGENT_PROVIDER } from '../../types/runtime'
import { AgentProviderIcon } from '../agent/panel/icons'
import { ModelSelector } from '../agent/panel/ModelSelector'
import { useSessionConfig } from '../agent/panel/useSessionConfig'

import type { AgentProvider } from '../../types/runtime'

/**
 * The Bot's runtime, model and effort in its chat's titlebar, picked from there
 * as from a conversation's composer. A provider icon alone says little for
 * OpenCode, which can run any provider's model.
 */
export function BotModelControl({
  teamId,
  botId,
  provider,
  owned,
}: {
  teamId: string
  botId: string
  provider?: AgentProvider
  /** Only the Bot's owner can change its settings; others see them. */
  owned: boolean
}) {
  const state = useSyncExternalStore(subscribeRuntimeStates, () => runtimeStateOf(botId))
  // While the Bot is in a turn, refreshes wait, so the runtime's model probe is not re-run.
  const busy = state ? !runtimeAllows(state, 'send') : false
  const control = useSessionConfig({ sessionId: botId, teamId }, busy)

  return (
    <div className="titlebar-no-drag flex min-w-0 shrink items-center text-secondary">
      <ModelSelector
        control={control}
        disabled={!owned}
        disabledHint={owned ? undefined : t('Only the owner can change model settings.')}
        side="bottom"
        inline
        leadingLabel={provider && AGENT_PROVIDER[provider].label}
        leading={
          provider && (
            <span className="flex shrink-0 items-center gap-1.5 text-tertiary">
              <AgentProviderIcon provider={provider} className="size-3.5 shrink-0" />
              <span className="whitespace-nowrap">{AGENT_PROVIDER[provider].label}</span>
              <span aria-hidden>·</span>
            </span>
          )
        }
      />
    </div>
  )
}
