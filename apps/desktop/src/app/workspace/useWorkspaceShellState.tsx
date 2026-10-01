import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'
import {} from '../../components/agent/AgentPanel'
import { track } from '../../lib/analytics'

import {} from '../../views/SettingsPage'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspacePane } from './WorkspacePaneContext'

import { useWorkspaceStore } from './store/useWorkspaceStore'

import type { PersistedWorkspaceTab } from '../../app/workspacePersistence'
import type { AccountSet, AgentPromptSeed } from '../../app/workspaceTabState'
import type { AgentSessionSnapshot } from '../../components/agent/AgentPanel'
import type { JournalChatTarget } from '../../lib/journalEvent'
import type {
  AtlasCluster,
  AtlasTeam,
  AwsEc2Instance,
  AwsLightsailInstance,
  DatabaseConnection,
  GcpComputeInstance,
  GithubInstallation,
  GitlabBinding,
  GitlabBindingNamespaces,
  GrafanaInstance,
  LkeCluster,
  TeamInvitation,
} from '../../types'

export function useWorkspaceShellState() {
  const [teams, setTeams] = useState<AtlasTeam[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<TeamInvitation[]>([])
  // Whether the initial pending-invitation fetch has resolved (success or
  // failure). The brand-new-user onboarding auto-entry waits on this so an
  // invited-but-teamless user is never trapped behind the overlay.
  const [invitationsLoaded, setInvitationsLoaded] = useState(false)
  const [accountsByTeam, setAccountsByTeam] = useState<Record<string, AccountSet | undefined>>({})
  const [databaseConnectionsByTeam, setDatabaseConnectionsByTeam] = useState<
    Record<string, DatabaseConnection[] | undefined>
  >({})
  const [clustersByParent, setClustersByParent] = useState<
    Record<string, AtlasCluster[] | undefined>
  >({})
  // Sibling LKE clusters for the breadcrumb cluster picker, keyed by
  // `${teamId}/${accountId}` — Linode has no role / service-account variants,
  // so this stays separate from the AWS/GCP `clustersByParent` cache.
  const [lkeClustersByAccount, setLkeClustersByAccount] = useState<
    Record<string, LkeCluster[] | undefined>
  >({})
  const [ec2InstancesByAccount, setEc2InstancesByAccount] = useState<
    Record<string, AwsEc2Instance[] | undefined>
  >({})
  const [lightsailInstancesByAccount, setLightsailInstancesByAccount] = useState<
    Record<string, AwsLightsailInstance[] | undefined>
  >({})
  const [gceInstancesByProject, setGceInstancesByProject] = useState<
    Record<string, GcpComputeInstance[] | undefined>
  >({})
  const workspace = useWorkspaceStore()
  const { workspaceActions } = workspace
  const [grafanaInstancesByTeam, setGrafanaInstancesByTeam] = useState<
    Record<string, GrafanaInstance[] | undefined>
  >({})
  const [githubInstallationsByTeam, setGithubInstallationsByTeam] = useState<
    Record<string, GithubInstallation[] | undefined>
  >({})
  const [gitlabBindingsByTeam, setGitlabBindingsByTeam] = useState<
    Record<string, GitlabBinding[] | undefined>
  >({})
  const [gitlabNamespacesByTeam, setGitlabNamespacesByTeam] = useState<
    Record<string, GitlabBindingNamespaces[] | undefined>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [bindGithubTarget, setBindGithubTarget] = useState<{
    teamId: string
    tabId: string
  } | null>(null)
  const [bindGitlabTarget, setBindGitlabTarget] = useState<{
    teamId: string
    tabId: string
  } | null>(null)
  const [createOrJoinOpen, setCreateOrJoinOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  // Snapshots of recently closed tabs, newest last, for ⌘⇧T reopen. Only the
  // persistable navigation state is kept — runtime state (SSH PTY etc.) is
  // rebuilt by restorePersistedTab, same as after a restart. `closedId` guards
  // against duplicate close requests for the same tab.
  const closedTabSnapshotsRef = useRef<(PersistedWorkspaceTab & { closedId: string })[]>([])
  // Section SettingsPage should land on when opened via a deep entry point
  // (e.g. picking Slack in the connector marketplace); null = default.
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | null>(null)
  const openSettingsSection = useCallback((section: string) => {
    setSettingsInitialSection(section)
    setSettingsOpen(true)
  }, [])
  // One-shot request from the sidebar Slack promo: navigate the active tab to
  // the connectors page and have it open the Slack bind dialog on arrival.
  const [slackBindRequested, setSlackBindRequested] = useState(false)
  const handleSlackBindRequested = useCallback(() => setSlackBindRequested(false), [])
  const pane = useWorkspacePane()
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState<boolean>(
    () => readLocalStorage('nuphos.sidebarCollapsed') === '1',
  )
  const toggleLocalSidebar = useCallback(() => setLocalSidebarCollapsed((value) => !value), [])
  const sidebarCollapsed = pane?.sidebarCollapsed ?? localSidebarCollapsed
  const toggleSidebarCollapsed = pane?.toggleSidebarCollapsed ?? toggleLocalSidebar

  useEffect(() => {
    if (!pane) writeLocalStorage('nuphos.sidebarCollapsed', localSidebarCollapsed ? '1' : '0')
  }, [pane, localSidebarCollapsed])
  // Expanded keeps the workspace dock mounted but lets it occupy the complete
  // main canvas. The persistent left rail then returns to resource navigation.
  const [workspaceDockExpanded, setWorkspaceDockExpanded] = useState(false)
  // The first-run connect walkthrough shares the right-hand dock with the workspace
  // panel — one slot, two possible occupants, so opening either closes the
  // other. It lives up here rather than in the tab pane because it is part of
  // the shell's layout, and because its steps have to survive the user changing
  // tabs to look something up mid-setup.
  const [firstRunPanelOpen, setFirstRunPanelOpen] = useState(false)
  // Dev-only override (`onboarding.firstRun()` in the console): treats the
  // team as first-run even with a cloud already bound, so the whole flow can
  // be retested without unbinding anything.
  const [firstRunDevForced, setFirstRunDevForced] = useState(false)
  const startFirstRunConnect = useCallback(() => {
    track('agent_first_run_connect_started')
    workspaceActions.setDockOpen(false)
    setFirstRunPanelOpen(true)
  }, [workspaceActions])
  const [agentSidebarPendingImport, setAgentSidebarPendingImport] =
    useState<AgentSessionSnapshot | null>(null)
  // Source conversation id to fork into the main Agent pane (continue a plan).
  const [agentSidebarPendingFork, setAgentSidebarPendingFork] = useState<string | null>(null)
  const clearAgentSidebarPendingFork = useCallback(() => setAgentSidebarPendingFork(null), [])
  // Journal entry the main Agent pane should scroll to once the audit-
  // opened conversation shows (journal entry click -> chat deep link).
  const [auditChatLocate, setAuditChatLocate] = useState<{
    sessionId: string
    target: JournalChatTarget
  } | null>(null)
  const [sidebarAgentPagePendingImport, setSidebarAgentPagePendingImport] = useState<{
    tabId: string
    snapshot: AgentSessionSnapshot
  } | null>(null)
  const clearSidebarAgentPagePendingImport = useCallback(
    () => setSidebarAgentPagePendingImport(null),
    [],
  )
  // Counter-based seed channel: each push increments `nonce` so the AgentPanel
  // effect refires even when the same link is pushed twice in a row. The
  // counter lives in a ref so consumers can reset the state back to null
  // without rewinding the nonce — otherwise the next push reuses nonce=1 and
  // the composer's "already seen" guard silently drops it.
  const chatPromptNonceRef = useRef(0)
  const [pendingChatPromptQueue, setPendingChatPromptQueue] = useState<AgentPromptSeed[]>([])

  return {
    ...workspace,
    teams,
    setTeams,
    pendingInvitations,
    setPendingInvitations,
    invitationsLoaded,
    setInvitationsLoaded,
    accountsByTeam,
    setAccountsByTeam,
    databaseConnectionsByTeam,
    setDatabaseConnectionsByTeam,
    clustersByParent,
    setClustersByParent,
    lkeClustersByAccount,
    setLkeClustersByAccount,
    ec2InstancesByAccount,
    setEc2InstancesByAccount,
    lightsailInstancesByAccount,
    setLightsailInstancesByAccount,
    gceInstancesByProject,
    setGceInstancesByProject,
    grafanaInstancesByTeam,
    setGrafanaInstancesByTeam,
    githubInstallationsByTeam,
    setGithubInstallationsByTeam,
    gitlabBindingsByTeam,
    setGitlabBindingsByTeam,
    gitlabNamespacesByTeam,
    setGitlabNamespacesByTeam,
    error,
    setError,
    bindGithubTarget,
    setBindGithubTarget,
    bindGitlabTarget,
    setBindGitlabTarget,
    createOrJoinOpen,
    setCreateOrJoinOpen,
    settingsOpen,
    setSettingsOpen,
    settingsInitialSection,
    setSettingsInitialSection,
    openSettingsSection,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    closedTabSnapshotsRef,
    slackBindRequested,
    setSlackBindRequested,
    handleSlackBindRequested,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    workspaceDockExpanded,
    setWorkspaceDockExpanded,
    firstRunPanelOpen,
    setFirstRunPanelOpen,
    firstRunDevForced,
    setFirstRunDevForced,
    startFirstRunConnect,
    agentSidebarPendingImport,
    setAgentSidebarPendingImport,
    agentSidebarPendingFork,
    setAgentSidebarPendingFork,
    clearAgentSidebarPendingFork,
    auditChatLocate,
    setAuditChatLocate,
    sidebarAgentPagePendingImport,
    setSidebarAgentPagePendingImport,
    clearSidebarAgentPagePendingImport,
    chatPromptNonceRef,
    pendingChatPromptQueue,
    setPendingChatPromptQueue,
  }
}

export type WorkspaceShellStateResult = ReturnType<typeof useWorkspaceShellState>
