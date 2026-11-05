import { useEffect, useState } from 'react'

import { api } from '../../api'
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
            openSettingsSection('workspace.agent')
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
