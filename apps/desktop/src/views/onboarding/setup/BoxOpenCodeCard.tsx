import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { t } from '../../../i18n'

import { StatusPill } from './SetupChrome'

/** OpenCode on the team's Box, starting until the Box joins. */
export function BoxOpenCodeCard({ computer, ready }: { computer: string; ready: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line-control bg-surface-sheet px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-main">
        <AgentProviderIcon provider="opencode" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-main">
          {t('{runtime} on {computer}', { runtime: 'OpenCode', computer })}
        </p>
        <p className="text-[12px] text-tertiary">
          {ready ? t('Free models, no sign-in needed') : t('Starting runtimes…')}
        </p>
      </div>
      <StatusPill status={ready ? 'ready' : 'checking'} />
    </div>
  )
}
