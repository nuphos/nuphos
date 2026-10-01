import { api } from '../../api'
import { DEFAULT_GITHUB_NAV, DEFAULT_REPO_PROVIDER } from '../../lib/appRoutes'
import { createTabId, nextCreatedSeq } from '../workspaceTabFactory'

import type { NavigationSnapshot } from '../../lib/appRoutes'
import type { AwsEc2Instance, AwsLightsailInstance } from '../../types'
import type { WorkspaceTabState } from '../workspaceTabState'
import type { SshTabContext } from './sshTabContext'

export function openLightsailSsh(
  ctx: SshTabContext,
  params: {
    teamId: string
    accountId: string
    roleId?: string
    instance: AwsLightsailInstance
  },
) {
  const { closedSshTabsRef, setError, openTab, updateTab } = ctx
  const { teamId, accountId, roleId, instance } = params

  if (!instance.username || !instance.publicIp) {
    setError('This Lightsail instance has no public SSH endpoint.')

    return
  }

  const tabId = createTabId()

  closedSshTabsRef.current.delete(tabId)
  const navigation: NavigationSnapshot = {
    scope: { kind: 'aws-account', teamId, accountId, roleId },
    active: 'aws.lightsail',
    target: null,
    grafanaInstance: null,
    dashboardTarget: null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    githubNav: DEFAULT_GITHUB_NAV,
    repoProvider: DEFAULT_REPO_PROVIDER,
    agentSessionId: null,
    s3Detail: null,
  }
  const tab: WorkspaceTabState = {
    id: tabId,
    createdSeq: nextCreatedSeq(),
    scope: navigation.scope,
    active: navigation.active,
    filter: '',
    refreshKey: 0,
    pollTick: 0,
    count: 0,
    viewLoading: false,
    target: navigation.target,
    grafanaInstance: navigation.grafanaInstance,
    dashboardTarget: navigation.dashboardTarget,
    traceDatasourceTarget: navigation.traceDatasourceTarget,
    logDatasourceTarget: navigation.logDatasourceTarget,
    githubNav: navigation.githubNav,
    gitlabNav: navigation.gitlabNav,
    repoProvider: navigation.repoProvider,
    s3Detail: navigation.s3Detail,
    namespaces: [],
    switching: false,
    clusterLabel: null,
    kubeconfigContext: null,
    kubeconfigContextError: null,
    navHistory: [navigation],
    navHistoryIndex: 0,
    pageMeta: null,
    agentSessionId: null,
    sshTerminal: {
      instanceName: instance.name,
      region: instance.region,
      publicIp: instance.publicIp,
      username: instance.username,
      sessionId: null,
      status: 'connecting',
      error: null,
    },
  }

  setError(null)
  openTab(tab)

  api
    .atlasStartAwsLightsailSsh(teamId, accountId, instance.name, instance.region, roleId)
    .then((session) => {
      if (closedSshTabsRef.current.has(tabId)) {
        closedSshTabsRef.current.delete(tabId)
        void api.sshTerminalClose(session.id)

        return
      }
      updateTab(tabId, (cur) =>
        cur.sshTerminal
          ? {
              ...cur,
              sshTerminal: {
                ...cur.sshTerminal,
                sessionId: session.id,
                status: 'connected',
                error: null,
              },
            }
          : cur,
      )
    })
    .catch((e: unknown) => {
      if (closedSshTabsRef.current.has(tabId)) {
        closedSshTabsRef.current.delete(tabId)

        return
      }
      const message = String(e instanceof Error ? e.message : e)

      updateTab(tabId, (cur) =>
        cur.sshTerminal
          ? {
              ...cur,
              sshTerminal: {
                ...cur.sshTerminal,
                status: 'error',
                error: message,
              },
            }
          : cur,
      )
    })
}

export function openEc2Ssh(
  ctx: SshTabContext,
  params: { teamId: string; accountId: string; roleId?: string; instance: AwsEc2Instance },
) {
  const { closedSshTabsRef, setError, openTab, updateTab } = ctx
  const { teamId, accountId, roleId, instance } = params

  if (!instance.publicIp) {
    setError('This EC2 instance has no public IP.')

    return
  }

  const tabId = createTabId()

  closedSshTabsRef.current.delete(tabId)
  const navigation: NavigationSnapshot = {
    scope: { kind: 'aws-account', teamId, accountId, roleId },
    active: 'aws.ec2',
    target: null,
    grafanaInstance: null,
    dashboardTarget: null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    githubNav: DEFAULT_GITHUB_NAV,
    repoProvider: DEFAULT_REPO_PROVIDER,
    agentSessionId: null,
    s3Detail: null,
  }
  const tab: WorkspaceTabState = {
    id: tabId,
    createdSeq: nextCreatedSeq(),
    scope: navigation.scope,
    active: navigation.active,
    filter: '',
    refreshKey: 0,
    pollTick: 0,
    count: 0,
    viewLoading: false,
    target: navigation.target,
    grafanaInstance: navigation.grafanaInstance,
    dashboardTarget: navigation.dashboardTarget,
    traceDatasourceTarget: navigation.traceDatasourceTarget,
    logDatasourceTarget: navigation.logDatasourceTarget,
    githubNav: navigation.githubNav,
    gitlabNav: navigation.gitlabNav,
    repoProvider: navigation.repoProvider,
    s3Detail: navigation.s3Detail,
    namespaces: [],
    switching: false,
    clusterLabel: null,
    kubeconfigContext: null,
    kubeconfigContextError: null,
    navHistory: [navigation],
    navHistoryIndex: 0,
    pageMeta: null,
    agentSessionId: null,
    sshTerminal: {
      instanceName: instance.instanceId,
      region: instance.region,
      publicIp: instance.publicIp,
      username: null,
      sessionId: null,
      status: 'connecting',
      error: null,
    },
  }

  setError(null)
  openTab(tab)

  api
    .atlasStartAwsEc2Ssh(teamId, accountId, instance.instanceId, instance.region, undefined, roleId)
    .then((session) => {
      if (closedSshTabsRef.current.has(tabId)) {
        closedSshTabsRef.current.delete(tabId)
        void api.sshTerminalClose(session.id)

        return
      }
      updateTab(tabId, (cur) =>
        cur.sshTerminal
          ? {
              ...cur,
              sshTerminal: {
                ...cur.sshTerminal,
                sessionId: session.id,
                status: 'connected',
                error: null,
              },
            }
          : cur,
      )
    })
    .catch((e: unknown) => {
      if (closedSshTabsRef.current.has(tabId)) {
        closedSshTabsRef.current.delete(tabId)

        return
      }
      const message = String(e instanceof Error ? e.message : e)

      updateTab(tabId, (cur) =>
        cur.sshTerminal
          ? {
              ...cur,
              sshTerminal: {
                ...cur.sshTerminal,
                status: 'error',
                error: message,
              },
            }
          : cur,
      )
    })
}
