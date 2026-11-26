import { useEffect, useState } from 'react'

import { api } from '../../api'
import { BotTemplateDialog } from '../../components/channels/BotTemplateDialog'
import { setSidebarMode } from '../../components/sidebar/sidebarModeStore'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { BindGithubDialog } from '../../views/BindGithubDialog'
import { BindGitlabDialog } from '../../views/BindGitlabDialog'
import { ConnectAgentDialog } from '../../views/settings/ConnectAgentDialog'
import { announcePersonalCredential } from '../../views/settings/personalCredentials'

import type { WorkspaceController } from './useWorkspaceController'
import type { ConnectAgentLink } from '../../lib/connectAgentLink'

export function WorkspaceBindDialogs({ ws }: { ws: WorkspaceController }) {
  const {
    bindGithubTarget,
    setBindGithubTarget,
    bindGitlabTarget,
    setBindGitlabTarget,
    updateTab,
    teams,
    currentTeam,
    switchTeam,
    openSettingsSection,
    onSidebarSelect,
  } = ws
  const [template, setTemplate] = useState<{ id: string; version: string } | null>(() => {
    if (!import.meta.env.DEV) return null
    const params = new URLSearchParams(window.location.search)

    const id = params.get('botTemplate')
    const version = params.get('templateVersion')

    return id && version ? { id, version } : null
  })

  useEffect(() => api.onBotTemplateDeepLink(setTemplate), [])
  const [connectAgent, setConnectAgent] = useState<ConnectAgentLink | null>(null)

  useEffect(() => api.onConnectAgentDeepLink(setConnectAgent), [])
  useEffect(() => api.onPersonalCredentialDeepLink(announcePersonalCredential), [])
  useEffect(
    () =>
      api.onConnectorStaleDeepLink(({ name }) =>
        toast.error(
          t('Could not connect {name}', { name }),
          t('This connection attempt expired or was cancelled. Click Connect again.'),
          {
            action: {
              label: t('Connect'),
              onClick: () => onSidebarSelect('team.integrations'),
            },
          },
        ),
      ),
    [onSidebarSelect],
  )

  return (
    <>
      {template && currentTeam && (
        <BotTemplateDialog
          key={JSON.stringify([currentTeam.id, template.id, template.version])}
          teamId={currentTeam.id}
          template={template}
          onClose={() => setTemplate(null)}
          onOpen={(id) => {
            // Its chat is listed under Bots, so the sidebar turns there as it opens.
            setSidebarMode(currentTeam.id, 0)
            ws.workspaceActions.selectSession(id)
          }}
        />
      )}
      {connectAgent && (
        <ConnectAgentDialog
          key={`${connectAgent.url}:${connectAgent.code}`}
          link={connectAgent}
          teams={teams}
          currentTeamId={currentTeam?.id}
          onClose={() => setConnectAgent(null)}
          onConnected={(teamId) => {
            setConnectAgent(null)
            switchTeam(teamId)
            openSettingsSection('workspace.computers')
          }}
        />
      )}
      {bindGithubTarget && (
        <BindGithubDialog
          open
          teamId={bindGithubTarget.teamId}
          onClose={() => setBindGithubTarget(null)}
          onBound={() => {
            const target = bindGithubTarget

            setBindGithubTarget(null)
            updateTab(target.tabId, (tab) => ({
              ...tab,
              refreshKey: tab.refreshKey + 1,
            }))
          }}
        />
      )}
      {bindGitlabTarget && (
        <BindGitlabDialog
          open
          teamId={bindGitlabTarget.teamId}
          onClose={() => setBindGitlabTarget(null)}
          onBound={() => {
            const target = bindGitlabTarget

            setBindGitlabTarget(null)
            updateTab(target.tabId, (tab) => ({
              ...tab,
              refreshKey: tab.refreshKey + 1,
            }))
          }}
        />
      )}
    </>
  )
}
