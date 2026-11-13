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
}: {
  teamId: string
  botId: string
  provider?: AgentProvider
}) {
  const control = useSessionConfig({ sessionId: botId, teamId }, false)

  return (
    <div className="titlebar-no-drag flex min-w-0 shrink items-center text-secondary">
      <ModelSelector
        control={control}
        disabled={false}
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
