import { ipcRenderer } from 'electron'

export const cloudOpsApi = {
  cloudProbeCliVersion: (provider: string, probeId?: string) =>
    ipcRenderer.invoke('cloud:probeCliVersion', provider, probeId),
  cloudProbeCli: (provider: string) => ipcRenderer.invoke('cloud:probeCli', provider),
  atlasStartAwsEc2Ssh: (
    teamId: string,
    accountId: string,
    instanceId: string,
    region?: string,
    username?: string,
    roleId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:startAwsEc2Ssh',
      teamId,
      accountId,
      instanceId,
      region,
      username,
      roleId,
    ),
  atlasListGcpComputeInstances: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpComputeInstances', teamId, projectId, serviceAccountId),
  atlasListGcpMetricDescriptors: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpMetricDescriptors', teamId, projectId, serviceAccountId),
  atlasQueryGcpMetricTimeSeries: (
    teamId: string,
    projectId: string,
    query: unknown,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:queryGcpMetricTimeSeries',
      teamId,
      projectId,
      query,
      serviceAccountId,
    ),
  atlasListGcpMonitoringDashboards: (
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => ipcRenderer.invoke('atlas:listGcpMonitoringDashboards', teamId, projectId, serviceAccountId),
  atlasGetGcpMonitoringDashboard: (
    teamId: string,
    projectId: string,
    dashboardId: string,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getGcpMonitoringDashboard',
      teamId,
      projectId,
      dashboardId,
      serviceAccountId,
    ),
  atlasQueryGcpMonitoringDashboardWidget: (
    teamId: string,
    projectId: string,
    dashboardId: string,
    widgetRef: string,
    query: unknown,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:queryGcpMonitoringDashboardWidget',
      teamId,
      projectId,
      dashboardId,
      widgetRef,
      query,
      serviceAccountId,
    ),
  atlasListGcpCloudRunServices: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:listGcpCloudRunServices', teamId, projectId, serviceAccountId),
  atlasStartGcpComputeSsh: (
    teamId: string,
    projectId: string,
    name: string,
    zone: string,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke('atlas:startGcpComputeSsh', teamId, projectId, name, zone, serviceAccountId),
  atlasUseAwsCluster: (
    teamId: string,
    accountId: string,
    name: string,
    region?: string,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:useAwsCluster', teamId, accountId, name, region, roleId),
  atlasUseGcpCluster: (
    teamId: string,
    projectId: string,
    name: string,
    location?: string,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke('atlas:useGcpCluster', teamId, projectId, name, location, serviceAccountId),
  atlasUseOnpremCluster: (teamId: string, clusterId: string) =>
    ipcRenderer.invoke('atlas:useOnpremCluster', teamId, clusterId),
  atlasListOnpremClusters: (teamId: string) =>
    ipcRenderer.invoke('atlas:listOnpremClusters', teamId),
  atlasEnrolOnpremCluster: (teamId: string, label: string, kubeconfig?: string) =>
    ipcRenderer.invoke('atlas:enrolOnpremCluster', teamId, label, kubeconfig),
  atlasOnpremClusterConnection: (teamId: string, clusterId: string) =>
    ipcRenderer.invoke('atlas:onpremClusterConnection', teamId, clusterId),
  atlasOnpremClusterAccess: (teamId: string, clusterId: string) =>
    ipcRenderer.invoke('atlas:onpremClusterAccess', teamId, clusterId),
  atlasSetOnpremClusterKubeconfig: (teamId: string, clusterId: string, kubeconfig: string) =>
    ipcRenderer.invoke('atlas:setOnpremClusterKubeconfig', teamId, clusterId, kubeconfig),
  atlasRotateOnpremClusterToken: (teamId: string, clusterId: string) =>
    ipcRenderer.invoke('atlas:rotateOnpremClusterToken', teamId, clusterId),
  atlasDeleteOnpremCluster: (teamId: string, clusterId: string) =>
    ipcRenderer.invoke('atlas:deleteOnpremCluster', teamId, clusterId),
  atlasListGrafanaInstances: (teamId: string) =>
    ipcRenderer.invoke('atlas:listGrafanaInstances', teamId),
  atlasBindGrafanaInstance: (teamId: string, name: string, grafanaUrl: string, saToken: string) =>
    ipcRenderer.invoke('atlas:bindGrafanaInstance', teamId, name, grafanaUrl, saToken),
  atlasUnbindGrafanaInstance: (teamId: string, instanceId: string) =>
    ipcRenderer.invoke('atlas:unbindGrafanaInstance', teamId, instanceId),
  atlasGrafanaProxy: (
    teamId: string,
    instanceId: string,
    method: string,
    path: string,
    body?: unknown,
  ) => ipcRenderer.invoke('atlas:grafanaProxy', teamId, instanceId, method, path, body),
  atlasListGithubInstallations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listGithubInstallations', teamId),
  atlasStartGithubInstall: (teamId: string) =>
    ipcRenderer.invoke('atlas:startGithubInstall', teamId),
  atlasUnbindGithubInstallation: (teamId: string, installationId: number) =>
    ipcRenderer.invoke('atlas:unbindGithubInstallation', teamId, installationId),
  atlasListGithubRepositories: (teamId: string, installationId: number) =>
    ipcRenderer.invoke('atlas:listGithubRepositories', teamId, installationId),
  atlasListGithubPulls: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
  ) => ipcRenderer.invoke('atlas:listGithubPulls', teamId, installationId, owner, repo, state),
  atlasGetGithubPull: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ) => ipcRenderer.invoke('atlas:getGithubPull', teamId, installationId, owner, repo, pullNumber),
  atlasListGithubActionRuns: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    page: number,
  ) => ipcRenderer.invoke('atlas:listGithubActionRuns', teamId, installationId, owner, repo, page),
  atlasListGitlabBindings: (teamId: string) =>
    ipcRenderer.invoke('atlas:listGitlabBindings', teamId),
  atlasStartGitlabOAuth: (
    teamId: string,
    hostUrl: string,
    clientId?: string,
    clientSecret?: string,
    scopes?: string[],
  ) =>
    ipcRenderer.invoke('atlas:startGitlabOAuth', teamId, hostUrl, clientId, clientSecret, scopes),
  atlasCancelGitlabOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelGitlabOAuth', teamId),
  atlasStartCloudflareConnect: (teamId: string, scopes?: string[]) =>
    ipcRenderer.invoke('atlas:startCloudflareConnect', teamId, scopes),
  atlasCancelCloudflareConnect: (teamId: string) =>
    ipcRenderer.invoke('atlas:cancelCloudflareConnect', teamId),
  atlasUnbindGitlab: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindGitlab', teamId, bindingId),
  atlasListGitlabNamespaces: (teamId: string) =>
    ipcRenderer.invoke('atlas:listGitlabNamespaces', teamId),
  atlasListGitlabProjects: (teamId: string, bindingId: string, namespaceFullPath?: string) =>
    ipcRenderer.invoke('atlas:listGitlabProjects', teamId, bindingId, namespaceFullPath),
  atlasListGitlabMergeRequests: (
    teamId: string,
    bindingId: string,
    projectId: number,
    state: 'opened' | 'closed' | 'merged' | 'all',
  ) => ipcRenderer.invoke('atlas:listGitlabMergeRequests', teamId, bindingId, projectId, state),
  atlasListGitlabPipelines: (teamId: string, bindingId: string, projectId: number, page: number) =>
    ipcRenderer.invoke('atlas:listGitlabPipelines', teamId, bindingId, projectId, page),
  atlasListTeamConnectors: (teamId: string) =>
    ipcRenderer.invoke('atlas:listTeamConnectors', teamId),
  atlasListLinearWorkspaces: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLinearWorkspaces', teamId),
  atlasStartLinearOAuth: (teamId: string) => ipcRenderer.invoke('atlas:startLinearOAuth', teamId),
  atlasCancelLinearOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelLinearOAuth', teamId),
  atlasUnbindLinear: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindLinear', teamId, bindingId),
  atlasGetLinearIssue: (teamId: string, bindingId: string, identifier: string) =>
    ipcRenderer.invoke('atlas:getLinearIssue', teamId, bindingId, identifier),
  atlasListLinearTeams: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:listLinearTeams', teamId, bindingId),
  atlasListLinearTeamIssues: (
    teamId: string,
    bindingId: string,
    linearTeamId: string,
    cursor?: string,
  ) => ipcRenderer.invoke('atlas:listLinearTeamIssues', teamId, bindingId, linearTeamId, cursor),
  atlasListJiraSites: (teamId: string) => ipcRenderer.invoke('atlas:listJiraSites', teamId),
  atlasStartJiraOAuth: (teamId: string) => ipcRenderer.invoke('atlas:startJiraOAuth', teamId),
  atlasCancelJiraOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelJiraOAuth', teamId),
  atlasUnbindJira: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindJira', teamId, bindingId),
  atlasListAsanaAccounts: (teamId: string) => ipcRenderer.invoke('atlas:listAsanaAccounts', teamId),
  atlasStartAsanaOAuth: (teamId: string) => ipcRenderer.invoke('atlas:startAsanaOAuth', teamId),
  atlasCancelAsanaOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelAsanaOAuth', teamId),
  atlasUnbindAsana: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindAsana', teamId, bindingId),
  atlasListSentryAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listSentryAccounts', teamId),
  atlasStartSentryOAuth: (teamId: string) => ipcRenderer.invoke('atlas:startSentryOAuth', teamId),
  atlasCancelSentryOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelSentryOAuth', teamId),
  atlasUnbindSentry: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindSentry', teamId, bindingId),
  agentStart: (args: {
    agentRuntime?: 'claude-code' | 'codex'
    runtimeId?: string
    streamId: string
    sessionId: string
    teamId?: string
    messages: unknown[]
    baseIndex?: number
    locale?: string
    url?: string
    // Current workspace tab's kubeconfig context, when one is bound. Forwarded
    // to the backend as `X-Atlas-Kube-Context` so the agent can pass it to
    // typed K8s tools (port_forward_start, etc.) without guessing.
    kubeContext?: string
    diagramId?: string
    resume?: boolean
    resumeFrom?: number
    continueAfterInterruption?: boolean
    resumeReason?: 'permission-decision' | 'approval-decision' | 'client-tool'
    credentialAccess?: {
      awsRoleIds: string[]
      gcpServiceAccountIds: string[]
      linodeAccountIds: string[]
      hetznerAccountIds: string[]
      betterStackIntegrationIds: string[]
      tailscaleClientIds: string[]
      zeaburIds: string[]
    }
  }) => ipcRenderer.invoke('agent:start', args),
  agentNotifyStopped: (args: { title: string; body: string; sessionId: string; teamId?: string }) =>
    ipcRenderer.invoke('agent:notifyStopped', args),
  agentAbort: (streamId: string) => ipcRenderer.invoke('agent:abort', streamId),
  agentReportFailure: (streamId: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:reportFailure', streamId, payload),
  agentAbortClientTools: (sessionId: string) =>
    ipcRenderer.invoke('agent:abortClientTools', sessionId),
  agentExecuteClientTool: (args: {
    sessionId: string
    toolCallId: string
    toolName: string
    input: unknown
  }) => ipcRenderer.invoke('agent:executeClientTool', args),
  agentListConversations: (
    teamId: string,
    options?: {
      cursor?: string
      limit?: number
      scope?: 'mine' | 'team' | 'shared'
      ownerId?: string
      triggerIds?: string[]
      search?: string
      archived?: 'exclude' | 'only'
      sort?: 'activity' | 'created' | 'archived'
    },
  ) => ipcRenderer.invoke('agent:listConversations', teamId, options),
  agentRenameConversation: (sessionId: string, title: string, teamId?: string) =>
    ipcRenderer.invoke('agent:renameConversation', sessionId, title, teamId),
  agentSetConversationArchived: (sessionId: string, archived: boolean, teamId?: string) =>
    ipcRenderer.invoke('agent:setConversationArchived', sessionId, archived, teamId),
  agentMarkConversationRead: (sessionId: string, seq: number, teamId?: string) =>
    ipcRenderer.invoke('agent:markConversationRead', sessionId, seq, teamId),
  agentCancelRuntime: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:cancelRuntime', sessionId, teamId),
  agentSteerConversation: (sessionId: string, text: string, teamId?: string) =>
    ipcRenderer.invoke('agent:steerConversation', sessionId, text, teamId),
  agentSlackPickup: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:slackPickup', sessionId, teamId),
}
