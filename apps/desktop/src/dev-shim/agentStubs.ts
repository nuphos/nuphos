/* eslint-disable @typescript-eslint/no-explicit-any */
import { agentRuntimeMethods } from './agentRuntimeMethods'
import { appendQuery, call, empty, noop } from './http.ts'

export function agentStubsMethods(): Record<string, any> {
  return {
    ...agentRuntimeMethods,
    cloudProbeCliVersion: () => empty(null),
    cloudProbeCli: () => empty({ installed: false, command: null, path: null }),
    // K8s & agent — empty stubs.
    listContexts: () => empty([]),
    listNamespaces: () => empty([]),
    listPods: () => empty([]),
    listDeployments: () => empty([]),
    listNodes: () => empty([]),
    listContainerUsage: () => empty([]),
    listServices: () => empty([]),
    listReplicaSets: () => empty([]),
    listStatefulSets: () => empty([]),
    listDaemonSets: () => empty([]),
    listJobs: () => empty([]),
    listIngresses: () => empty([]),
    listEndpointSlices: () => empty([]),
    listConfigMaps: () => empty([]),
    listSecrets: () => empty([]),
    listStorageClasses: () => empty([]),
    deletePod: noop,
    deleteResource: noop,
    uninstallHelmRelease: noop,
    cordonNode: noop,
    restartDeployment: noop,
    scaleDeployment: noop,
    upsertConfigMapKey: noop,
    removeConfigMapKey: noop,
    upsertSecretKey: noop,
    removeSecretKey: noop,
    getPodDetail: () => empty({}),
    getNodeDetail: () =>
      empty({
        name: '',
        status: 'Unknown',
        age: null,
        os_image: null,
        kernel_version: null,
        kubelet_version: null,
        kube_proxy_version: null,
        hostname: null,
        internal_ip: null,
        external_ip: null,
        roles: [],
        taints: [],
        conditions: [],
        labels: [],
        annotations: [],
        schedulable: true,
        utilization: {
          cpu: { usage: null, capacity: null, allocatable: null, requests: null, limits: null },
          memory: { usage: null, capacity: null, allocatable: null, requests: null, limits: null },
        },
        scheduled_pods: [],
        pods_capacity: null,
      }),
    getPodLogs: () => empty([]),
    getWorkloadPreviousLogs: () => empty([]),
    saveTextFile: () => empty({ saved: false }),
    getResourceYaml: () => empty(''),
    listEvents: () => empty([]),
    agentStart: noop,
    agentAbort: () => empty({ status: 'failed' as const, detail: 'dev shim' }),
    agentReportFailure: noop,
    agentAbortClientTools: noop,
    agentExecuteClientTool: () =>
      empty({ ok: false, error: 'Client-side tools require Electron.' }),
    agentListConversations: () => empty({ conversations: [], nextCursor: null, hasMore: false }),
    agentRenameConversation: (_sessionId: string, title: string) => empty({ title }),
    agentSetConversationArchived: (_sessionId: string, archived: boolean) =>
      empty({ ok: true, archived }),
    agentGetConversation: () =>
      empty({
        sessionId: '',
        title: 'New chat',
        firstMessage: '',
        messageCount: 0,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      }),
    agentGetConversationMessages: () => empty({ messages: [], firstIndex: 0 }),
    agentGetCredentialOptions: () =>
      empty({
        awsRoles: [],
        gcpServiceAccounts: [],
        linodeAccounts: [],
        hetznerAccounts: [],
        betterStackIntegrations: [],
        tailscaleClients: [],
        zeaburProviders: [],
        vantaIntegrations: [],
        secureframeIntegrations: [],
      }),
    agentGetStarterSuggestions: () => empty({ suggestions: [] }),
    agentUpdateConversationCredentials: (args: {
      credentialAccess: {
        awsRoleIds: string[]
        gcpServiceAccountIds: string[]
        linodeAccountIds?: string[]
        hetznerAccountIds?: string[]
        tailscaleClientIds?: string[]
        zeaburIds?: string[]
        vantaIntegrationIds?: string[]
        secureframeIntegrationIds?: string[]
      }
    }) =>
      empty({
        credentialAccess: {
          ...args.credentialAccess,
          linodeAccountIds: args.credentialAccess.linodeAccountIds ?? [],
          hetznerAccountIds: args.credentialAccess.hetznerAccountIds ?? [],
          tailscaleClientIds: args.credentialAccess.tailscaleClientIds ?? [],
          zeaburIds: args.credentialAccess.zeaburIds ?? [],
          vantaIntegrationIds: args.credentialAccess.vantaIntegrationIds ?? [],
          secureframeIntegrationIds: args.credentialAccess.secureframeIntegrationIds ?? [],
        },
        options: {
          awsRoles: [],
          gcpServiceAccounts: [],
          linodeAccounts: [],
          hetznerAccounts: [],
          betterStackIntegrations: [],
          tailscaleClients: [],
          zeaburProviders: [],
          vantaIntegrations: [],
          secureframeIntegrations: [],
        },
      }),
    agentSyncConversationTranscript: noop,
    agentDeleteConversation: noop,
    agentSendMessageFeedback: (args: {
      sessionId: string
      messageId: string
      rating: 'up' | 'down' | null
      comment?: string
      teamId?: string
    }) =>
      call(
        'POST',
        appendQuery(
          `/agent/conversations/${encodeURIComponent(args.sessionId)}/messages/${encodeURIComponent(args.messageId)}/feedback`,
          { teamId: args.teamId },
        ),
        { rating: args.rating, ...(args.comment ? { comment: args.comment } : {}) },
      ),
    agentListPlans: (args: { teamId?: string; mine?: boolean; cursor?: string; limit?: number }) =>
      call('GET', appendQuery('/agent/plans', args ?? {})),
    agentGetPlan: (planId: string, teamId?: string) =>
      call('GET', appendQuery(`/agent/plans/${encodeURIComponent(planId)}`, { teamId })),
    agentUpdatePlan: (planId: string, patch: unknown, teamId?: string) =>
      call('PATCH', appendQuery(`/agent/plans/${encodeURIComponent(planId)}`, { teamId }), patch),
    agentGetPlanApprovalPolicy: (teamId: string) =>
      call('GET', appendQuery('/agent/plan-approval-policy', { teamId })),
    agentUpdatePlanApprovalPolicy: (teamId: string, minimumOtherApprovals: number) =>
      call('PUT', '/agent/plan-approval-policy', {
        teamId,
        requesterApprovalRequired: true,
        minimumOtherApprovals,
      }),
    agentRetryPlan: (planId: string, teamId?: string) =>
      call('POST', appendQuery(`/agent/plans/${encodeURIComponent(planId)}/retry`, { teamId }), {}),
    appOpenExternal: (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')

      return Promise.resolve()
    },
    appOpenSsh: (url: string) => {
      const parsed = new URL(url)

      if (parsed.protocol !== 'ssh:') {
        return Promise.reject(new Error('Only ssh URLs can be opened by this action.'))
      }
      window.location.href = parsed.toString()

      return Promise.resolve()
    },
    sshTerminalInput: async () => {},
    sshTerminalReplay: async () => {},
    sshTerminalClose: async () => {},
    onSshTerminalEvent: () => () => {},
    onAgentEvent: () => () => {},
    onAgentChatDeepLink: () => () => {},
    onAppOpenDeepLink: () => () => {},
    onConnectAgentDeepLink: () => () => {},
    onAgentFocusSession: () => () => {},
    onAgentPlanUpdated: () => () => {},
    onAppShortcut: () => () => {},
    k8sStartPortForward: async () => ({
      id: 'stub',
      namespace: 'default',
      podName: 'pod',
      targetPort: 8080,
      localPort: 18080,
      startedAt: new Date().toISOString(),
    }),
    k8sStartServicePortForward: async () => ({
      id: 'stub-service',
      namespace: 'default',
      podName: 'service-pod',
      targetPort: 8080,
      localPort: 18080,
      startedAt: new Date().toISOString(),
    }),
    k8sGetPodPortForwardOptions: async () => [],
    k8sGetServicePortForwardOptions: async () => [],
    k8sStopPortForward: async () => {},
    k8sListPortForwards: async () => [],
    onPortForwardEvent: () => () => {},

    // Agent memory (ADR-0007 #3: devShim parity — mirrors electron/agent.ts).
    agentListMemories: (
      cursor?: string,
      limit?: number,
      teamId?: string,
      scope = 'personal',
      state?: 'live' | 'removed',
    ) =>
      call(
        'GET',
        appendQuery('/agent/memories', {
          cursor,
          limit,
          teamId,
          scope,
          state: state === 'removed' ? 'removed' : undefined,
        }),
      ),
    agentGetMemory: (memoryId: string, teamId?: string, scope = 'personal') =>
      call(
        'GET',
        appendQuery(`/agent/memories/${encodeURIComponent(memoryId)}`, { teamId, scope }),
      ),
    agentGetMemoryIngestEvent: (
      sessionId: string,
      teamId?: string,
      eventId?: string,
      turnKey?: string,
    ) =>
      call(
        'GET',
        appendQuery(`/agent/memories/ingest/${encodeURIComponent(sessionId)}`, {
          teamId,
          eventId,
          turnKey,
        }),
      ),
    agentGetMemoryAttribution: (sessionId: string, teamId?: string, turnKey?: string) =>
      call(
        'GET',
        appendQuery(`/agent/memories/attribution/${encodeURIComponent(sessionId)}`, {
          teamId,
          turnKey,
        }),
      ),
    agentGetMemoryScorecard: (teamId?: string, ids?: string[]) =>
      call(
        'GET',
        appendQuery('/agent/memories/scorecard', {
          teamId,
          ids: ids?.length ? ids.join(',') : undefined,
        }),
      ),
    agentDeleteMemory: (memoryId: string, teamId?: string, scope = 'personal', reason?: string) =>
      call(
        'DELETE',
        appendQuery(`/agent/memories/${encodeURIComponent(memoryId)}`, { teamId, scope, reason }),
      ).then(() => {}),
    agentRestoreMemory: (memoryId: string, teamId?: string, scope = 'personal') =>
      call(
        'POST',
        appendQuery(`/agent/memories/${encodeURIComponent(memoryId)}/restore`, { teamId, scope }),
      ).then(() => {}),
  }
}
