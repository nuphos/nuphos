import { t } from '../../i18n'
import { RuntimeUsageBar } from '../../views/settings/RuntimeUsageBar'
import { AgentProviderIcon } from '../agent/panel/icons'
import { ModelSelector } from '../agent/panel/ModelSelector'
import { RuntimeSelector } from '../agent/panel/RuntimeSelector'
import { threadRuntimeName } from '../agent/panel/threadBadges'
import { useSessionConfig } from '../agent/panel/useSessionConfig'
import { SummaryRow, SummarySection } from '../agent/summary/ChatSummaryRows'

import type { AgentProvider } from '../../types/runtime'
import type { RuntimeControl } from '../agent/panel/RuntimeSelector'

/**
 * Where a Bot runs and the model it answers with, in its details: the pickers its chat's composer
 * had, each opening under its row. Only the owner changes them; anyone else reads them.
 */
export function BotRuntimeSection({
  teamId,
  bot,
  runtime,
  listed,
  owned,
}: {
  teamId: string
  bot: string
  /** The owner's control of the Bot's runtime; undefined for anyone else, or until it loads. */
  runtime: RuntimeControl | undefined
  /** The sidebar's row of the Bot, for what a teammate reads. */
  listed: { agentRuntime?: AgentProvider; runtimeId?: string; runtimeLabel?: string } | undefined
  owned: boolean
}) {
  const model = useSessionConfig(
    { sessionId: bot, teamId, runtimeId: runtime?.value?.id ?? listed?.runtimeId },
    false,
  )
  const provider = runtime?.value?.provider ?? listed?.agentRuntime

  if (owned && !runtime) return null

  return (
    <SummarySection
      title={t('Runtime')}
      action={usage(runtime)}
    >
      {owned && runtime ? (
        <RuntimeSelector {...runtime} asRow />
      ) : (
        <SummaryRow
          icon={<AgentProviderIcon provider={provider} className="size-3.5" />}
          label={t('Runtime')}
          note={threadRuntimeName(provider, listed?.runtimeLabel)}
        />
      )}
      <ModelSelector
        control={model}
        disabled={!owned}
        disabledHint={owned ? undefined : t('Only the owner can change model settings.')}
        asRow
      />
    </SummarySection>
  )
}

/** #3252: what is left of the runtime's usage, as the Task composer's runtime chip shows it. */
function usage(runtime: RuntimeControl | undefined) {
  const id = runtime?.value?.id

  // Inset back from the overhang a header action button gets.
  return (
    id && (
      <span className="my-1.5 mr-2">
        <RuntimeUsageBar quota={runtime.quotas?.get(id)} />
      </span>
    )
  )
}
