import { useEffect } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { mergeIfChanged } from '../../lib/mergeIfChanged'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult

export function useWorkspaceTeamResources(a: Args) {
  const {
    setAccountsByTeam,
    activeTabId,
    setGrafanaInstancesByTeam,
    setGithubInstallationsByTeam,
    setGitlabBindingsByTeam,
    setGitlabNamespacesByTeam,
    scope,
    refreshKey,
    updateTab,
  } = a

  // Load accounts + projects when team or refreshKey changes.
  const teamId = scope?.teamId

  useEffect(() => {
    if (!teamId) return
    // The spinner belongs to the active dock tab; the load does not. The agent
    // home reads these accounts too (first-run vs bound), with no tab open.
    const tabId = activeTabId
    let cancelled = false
    let loadDone = false
    let spinnerFrame: number | null = null
    let spinnerTimer: number | null = null

    if (tabId && scope?.kind === 'team') {
      // Deferred past the frame: a spinner is not worth an extra App commit
      // between the click and the switch becoming visible — and when the load
      // wins the race it never shows at all.
      spinnerFrame = requestAnimationFrame(() => {
        spinnerTimer = window.setTimeout(() => {
          if (cancelled || loadDone) return
          updateTab(tabId, (tab) => (tab.viewLoading ? tab : { ...tab, viewLoading: true }))
        }, 0)
      })
    }
    // Back to "unknown" until this team's bundle lands — the previous team's
    // environment headroom must not gate (or clear the gate on) this one.
    // One aggregated round trip instead of ~20 per-provider list calls — the
    // whole connector inventory arrives (and renders) at once.
    api
      .atlasListTeamConnectors(teamId)
      .then((bundle) => {
        if (cancelled) return
        // Default every provider array to [] — a connectors bundle from an
        // older/mismatched backend may omit newer keys, and mapping over an
        // undefined field would crash the whole Workspace (ZEA: tencent map).
        // mergeIfChanged: a refetch that changed nothing must not change the
        // map's identity — that one echo commit re-rendered the whole App
        // ~300ms after every tab switch.
        setAccountsByTeam((prev) =>
          mergeIfChanged(prev, teamId, {
            aws: bundle.aws ?? [],
            gcp: bundle.gcp ?? [],
            cloudflare: bundle.cloudflare ?? [],
            linode: bundle.linode ?? [],
            hetzner: bundle.hetzner ?? [],
            vanta: bundle.vanta ?? [],
            secureframe: bundle.secureframe ?? [],
            sonarqube: bundle.sonarqube ?? [],
            notion: bundle.notion ?? [],
            onprem: bundle.onprem ?? [],
            upstash: bundle.upstash ?? [],
            resend: bundle.resend ?? [],
            tencent: bundle.tencent ?? [],
            aliyun: bundle.aliyun ?? [],
            volcengine: bundle.volcengine ?? [],
            huawei: bundle.huawei ?? [],
            azure: bundle.azure ?? [],
            betterstack: bundle.betterstack ?? [],
            uptimeKuma: bundle.uptimeKuma ?? [],
            tailscale: bundle.tailscale ?? [],
            zeabur: bundle.zeabur ?? [],
            linear: bundle.linear ?? [],
            jira: bundle.jira ?? [],
            asana: bundle.asana ?? [],
            sentry: bundle.sentry ?? [],
            posthog: bundle.posthog ?? [],
            discordConnection: bundle.discord ?? null,
            slackInstallation: bundle.slack?.installation ?? null,
            slackLinkedChannels: bundle.slack?.linkedChannels ?? null,
            larkInstallation: bundle.lark?.installation ?? null,
          }),
        )
        setGithubInstallationsByTeam((prev) => mergeIfChanged(prev, teamId, bundle.github))
        setGitlabBindingsByTeam((prev) => mergeIfChanged(prev, teamId, bundle.gitlab))
        setGrafanaInstancesByTeam((prev) => mergeIfChanged(prev, teamId, bundle.grafana))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast.apiError('Failed to load connectors', e)
      })
      .finally(() => {
        loadDone = true
        if (tabId && !cancelled && scope?.kind === 'team') {
          updateTab(tabId, (tab) => (tab.viewLoading ? { ...tab, viewLoading: false } : tab))
        }
      })

    return () => {
      cancelled = true
      if (spinnerFrame != null) window.cancelAnimationFrame(spinnerFrame)
      if (spinnerTimer != null) window.clearTimeout(spinnerTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, refreshKey, scope?.kind, activeTabId, updateTab])

  // Grafana instances, GitHub installations, and GitLab bindings arrive with
  // the aggregated connectors bundle above — no separate loads.

  useEffect(() => {
    if (!teamId) return
    let cancelled = false

    api
      .atlasListGitlabNamespaces(teamId)
      .then((rows) => {
        if (cancelled) return
        setGitlabNamespacesByTeam((prev) => mergeIfChanged(prev, teamId, rows))
      })
      .catch(() => {
        if (cancelled) return
        setGitlabNamespacesByTeam((prev) => ({ ...prev, [teamId]: [] }))
      })

    return () => {
      cancelled = true
    }
  }, [teamId, refreshKey, setGitlabNamespacesByTeam])

  return {
    teamId,
  }
}

export type WorkspaceTeamResourcesResult = ReturnType<typeof useWorkspaceTeamResources>
