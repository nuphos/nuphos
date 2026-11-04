import { Check, FolderOpen, Monitor } from 'lucide-react'

import { ClaudeIcon, CodexIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { t } from '../../../i18n'

import { LOCAL_AGENT_INFO, readyLocalAgents } from './agentSetup'
import { SetupScreen, StatusPill } from './SetupChrome'

import type { ReactNode } from 'react'

function AgentRow({
  icon,
  name,
  where,
  status,
}: {
  icon: ReactNode
  name: string
  where: string
  status: 'ready'
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zGray-800 text-main">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-main">{name}</p>
        <p className="text-[12px] text-tertiary">{where}</p>
      </div>
      <StatusPill status={status} />
    </li>
  )
}

/** Summarize readiness and let the user choose when to enter the workspace. */
export function SetupComplete({
  onFinish,
  onBack,
  workspaceCreated = false,
}: {
  onFinish: () => void
  onBack: () => void
  workspaceCreated?: boolean
}) {
  const local = readyLocalAgents(useLocalRuntimeState())
  const empty = local.length === 0

  return (
    <SetupScreen
      step={3}
      title={workspaceCreated ? t('Your workspace is ready') : t('Continue to your workspace')}
      subtitle={
        empty
          ? t('Connect a runtime when you’re ready to start your first conversation.')
          : t('Start a conversation, give your runtime a task, and work through it with your team.')
      }
      hint={t('You can manage runtimes any time in Settings › Runtimes.')}
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            {t('Back')}
          </Button>
          <Button onClick={onFinish}>{t('Open workspace')}</Button>
        </>
      }
    >
      <ul className="space-y-3">
        <li className="flex items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zGray-800 text-main">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-main">
              {workspaceCreated ? t('Workspace created') : t('Workspace available')}
            </p>
            <p className="text-[12px] text-tertiary">
              {t('A shared place for your team’s conversations and work.')}
            </p>
          </div>
          <Check className="h-4 w-4 shrink-0 text-success" aria-label={t('Complete')} />
        </li>
        {empty && (
          <li className="flex items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zGray-800 text-tertiary">
              <Monitor className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-main">{t('Runtime setup skipped')}</p>
              <p className="text-[12px] text-tertiary">
                {t('Connect Claude Code or Codex to start working.')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onBack}>
              {t('Connect a runtime')}
            </Button>
          </li>
        )}
        {local.map((provider) => {
          const Icon = provider === 'codex' ? CodexIcon : ClaudeIcon

          return (
            <AgentRow
              key={provider}
              icon={<Icon className="h-5 w-5" />}
              name={LOCAL_AGENT_INFO[provider].name}
              where={t('On this computer')}
              status="ready"
            />
          )
        })}
      </ul>
    </SetupScreen>
  )
}
