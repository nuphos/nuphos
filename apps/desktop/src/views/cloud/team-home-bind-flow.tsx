import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

import { AddIntegrationModal } from '../AddIntegrationModal'
import { useResetOnKey } from '../useResetOnKey'

import { isBindDialogKey } from './team-home-bind'
import { TeamHomeBindDialogs } from './team-home-dialogs'

import type { BindMode } from './connector-actions'
import type { BindProvider } from './team-home-bind'
import type { FocusedConnector } from './team-home-dialogs'
import type { AddIntegrationKey } from '../AddIntegrationModal'

export type TeamHomeBindFlowHandle = {
  openIntegration: (key: AddIntegrationKey, mode?: BindMode) => void
}

export const TeamHomeBindFlow = forwardRef<
  TeamHomeBindFlowHandle,
  {
    teamId: string
    onOpenAgentChat: (prompt: string) => void
    onOpenSettingsSection: (section: string) => void
    onChanged: () => void
    onFocusConnector?: (detail: FocusedConnector) => void
    addIntegrationOpen?: boolean
    onAddIntegrationOpenChange?: (open: boolean) => void
    slackBindRequested?: boolean
    onSlackBindHandled?: () => void
  }
>(function TeamHomeBindFlow(
  {
    teamId,
    onOpenAgentChat,
    onChanged,
    onFocusConnector,
    addIntegrationOpen,
    onAddIntegrationOpenChange,
    slackBindRequested = false,
    onSlackBindHandled,
  },
  ref,
) {
  const [bindProvider, setBindProvider] = useState<BindProvider | null>(null)
  const [bindGithubOpen, setBindGithubOpen] = useState(false)
  const [bindGitlabOpen, setBindGitlabOpen] = useState(false)
  const [bindLinearOpen, setBindLinearOpen] = useState(false)
  const [bindJiraOpen, setBindJiraOpen] = useState(false)
  const [bindAsanaOpen, setBindAsanaOpen] = useState(false)
  const [bindSentryOpen, setBindSentryOpen] = useState(false)
  const [bindPosthogOpen, setBindPosthogOpen] = useState(false)
  const [bindGrafanaOpen, setBindGrafanaOpen] = useState(false)
  const [bindSonarqubeOpen, setBindSonarqubeOpen] = useState(false)
  const [bindOnpremOpen, setBindOnpremOpen] = useState(false)
  const [bindDatabaseOpen, setBindDatabaseOpen] = useState(false)
  const [bindSlackOpen, setBindSlackOpen] = useState(slackBindRequested ?? false)
  const [bindDiscordOpen, setBindDiscordOpen] = useState(false)
  const [bindLarkOpen, setBindLarkOpen] = useState(false)
  const [bindMode, setBindMode] = useState<BindMode>('install')

  // Deep entry points (the sidebar Slack promo) request the Slack bind dialog
  // via a consumable flag: open once, then ack so a later remount stays shut.
  useResetOnKey(String(slackBindRequested ?? false), () => {
    if (slackBindRequested) setBindSlackOpen(true)
  })
  useEffect(() => {
    if (!slackBindRequested) return
    onSlackBindHandled?.()
  }, [slackBindRequested, onSlackBindHandled])
  // Linear/Jira/Asana/Slack arrive with the aggregated connectors bundle,
  // threaded from App like every other provider — no local fetches here.
  // The "Add integration" marketplace modal. Prefer the URL-driven prop when the
  // parent supplies it; otherwise keep purely local state.
  const [localAddOpen, setLocalAddOpen] = useState(false)
  const addOpen = addIntegrationOpen ?? localAddOpen
  const setAddOpen = (open: boolean) => {
    if (onAddIntegrationOpenChange) onAddIntegrationOpenChange(open)
    else setLocalAddOpen(open)
  }

  function handlePickIntegration(key: AddIntegrationKey, mode: BindMode = 'install') {
    setAddOpen(false)
    setBindMode(mode)
    if (!isBindDialogKey(key)) {
      setBindProvider(key)

      return
    }
    switch (key) {
      case 'github':
        setBindGithubOpen(true)
        break
      case 'gitlab':
        setBindGitlabOpen(true)
        break
      case 'linear':
        setBindLinearOpen(true)
        break
      case 'jira':
        setBindJiraOpen(true)
        break
      case 'sentry':
        setBindSentryOpen(true)
        break
      case 'posthog':
        setBindPosthogOpen(true)
        break
      case 'asana':
        setBindAsanaOpen(true)
        break
      case 'grafana':
        setBindGrafanaOpen(true)
        break
      case 'sonarqube':
        setBindSonarqubeOpen(true)
        break
      case 'onprem-k8s':
        setBindOnpremOpen(true)
        break
      case 'slack':
        setBindSlackOpen(true)
        break
      case 'discord':
        setBindDiscordOpen(true)
        break
      case 'lark':
        setBindLarkOpen(true)
        break
      case 'mongodb':
        setBindDatabaseOpen(true)
        break
    }
  }

  useImperativeHandle(ref, () => ({ openIntegration: handlePickIntegration }))

  return (
    <>
      <AddIntegrationModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onPick={(key) => handlePickIntegration(key)}
      />
      <TeamHomeBindDialogs
        teamId={teamId}
        onOpenAgentChat={onOpenAgentChat}
        onChanged={onChanged}
        onFocusConnector={onFocusConnector}
        bindProvider={bindProvider}
        setBindProvider={setBindProvider}
        bindGithubOpen={bindGithubOpen}
        setBindGithubOpen={setBindGithubOpen}
        bindGitlabOpen={bindGitlabOpen}
        setBindGitlabOpen={setBindGitlabOpen}
        bindLinearOpen={bindLinearOpen}
        setBindLinearOpen={setBindLinearOpen}
        bindJiraOpen={bindJiraOpen}
        setBindJiraOpen={setBindJiraOpen}
        bindAsanaOpen={bindAsanaOpen}
        setBindAsanaOpen={setBindAsanaOpen}
        bindSentryOpen={bindSentryOpen}
        setBindSentryOpen={setBindSentryOpen}
        bindPosthogOpen={bindPosthogOpen}
        setBindPosthogOpen={setBindPosthogOpen}
        bindGrafanaOpen={bindGrafanaOpen}
        setBindGrafanaOpen={setBindGrafanaOpen}
        bindSonarqubeOpen={bindSonarqubeOpen}
        setBindSonarqubeOpen={setBindSonarqubeOpen}
        bindOnpremOpen={bindOnpremOpen}
        setBindOnpremOpen={setBindOnpremOpen}
        bindDatabaseOpen={bindDatabaseOpen}
        setBindDatabaseOpen={setBindDatabaseOpen}
        bindSlackOpen={bindSlackOpen}
        setBindSlackOpen={setBindSlackOpen}
        bindDiscordOpen={bindDiscordOpen}
        setBindDiscordOpen={setBindDiscordOpen}
        bindLarkOpen={bindLarkOpen}
        setBindLarkOpen={setBindLarkOpen}
        bindMode={bindMode}
      />
    </>
  )
})
