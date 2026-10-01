import { ipcRenderer } from 'electron'

export const agentApi = {
  agentMoveConversationRuntime: (
    sessionId: string,
    teamId: string,
    runtimeId: string,
    mode: 'history' | 'workspace',
  ) => ipcRenderer.invoke('agent:moveConversationRuntime', sessionId, teamId, runtimeId, mode),
  agentGetSessionConfig: (sessionId: string, teamId: string) =>
    ipcRenderer.invoke('agent:getSessionConfig', sessionId, teamId),
  agentGetConversationParticipants: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:getConversationParticipants', sessionId, teamId),
  agentInviteConversationParticipants: (sessionId: string, teamId: string, userIds: string[]) =>
    ipcRenderer.invoke('agent:inviteConversationParticipants', sessionId, teamId, userIds),
  agentImportLocalSession: (args: {
    source: 'claude-code' | 'codex'
    id: string
    teamId: string
    runtimeId: string
    agentRuntime: 'claude-code' | 'codex'
  }) => ipcRenderer.invoke('agent:importLocalSession', args),
  agentSetSessionConfig: (
    sessionId: string,
    teamId: string,
    selection: { configId: string; value: string },
  ) => ipcRenderer.invoke('agent:setSessionConfig', sessionId, teamId, selection),
  agentGetConversation: (sessionId: string, teamId?: string, options?: { tail?: number }) =>
    ipcRenderer.invoke('agent:getConversation', sessionId, teamId, options),
  agentGetConversationMessages: (
    sessionId: string,
    args: { before: number; limit?: number },
    teamId?: string,
  ) => ipcRenderer.invoke('agent:getConversationMessages', sessionId, args, teamId),
  agentGetJournal: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:getJournal', sessionId, teamId),
  agentListJournalConversations: (args: {
    scope?: 'mine' | 'team'
    teamId?: string
    userId?: string
    sessionId?: string
    sessionIds?: string[]
    mutationsOnly?: boolean
    from?: string
    to?: string
    cursor?: string
  }) => ipcRenderer.invoke('agent:listJournalConversations', args),
  agentListJournalEvents: (args: {
    scope?: 'mine' | 'team'
    teamId?: string
    userId?: string
    sessionId?: string
    mutationsOnly?: boolean
    from?: string
    to?: string
    cursor?: string
  }) => ipcRenderer.invoke('agent:listJournalEvents', args),
  agentExportJournal: (args: {
    scope?: 'mine' | 'team'
    teamId?: string
    userId?: string
    sessionId?: string
    mutationsOnly?: boolean
    from?: string
    to?: string
  }) => ipcRenderer.invoke('agent:exportJournal', args),
  agentGetCredentialOptions: (teamId?: string) =>
    ipcRenderer.invoke('agent:getCredentialOptions', teamId),
  agentGetStarterSuggestions: (args: { teamId?: string; resources: string[]; locale?: string }) =>
    ipcRenderer.invoke('agent:getStarterSuggestions', args),
  agentUpdateConversationCredentials: (args: {
    sessionId: string
    teamId?: string
    credentialAccess: {
      awsRoleIds: string[]
      gcpServiceAccountIds: string[]
      linodeAccountIds: string[]
      hetznerAccountIds: string[]
      betterStackIntegrationIds: string[]
      tailscaleClientIds: string[]
      zeaburIds: string[]
    }
  }) => ipcRenderer.invoke('agent:updateConversationCredentials', args),
  agentSyncConversationTranscript: (args: {
    agentRuntime?: 'claude-code' | 'codex'
    runtimeId?: string
    baseIndex?: number
    sessionId: string
    teamId?: string
    title: string
    messages: {
      id: string
      role: 'user' | 'assistant'
      parts: unknown[]
    }[]
  }) => ipcRenderer.invoke('agent:syncConversationTranscript', args),
  agentDeleteConversation: (sessionId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:deleteConversation', sessionId, teamId),
  agentSendMessageFeedback: (args: {
    sessionId: string
    messageId: string
    rating: 'up' | 'down' | null
    comment?: string
    teamId?: string
  }) => ipcRenderer.invoke('agent:sendMessageFeedback', args),
  agentListMemories: (
    cursor?: string,
    limit?: number,
    teamId?: string,
    scope?: 'personal' | 'team',
    state?: 'live' | 'removed',
  ) => ipcRenderer.invoke('agent:listMemories', cursor, limit, teamId, scope, state),
  agentGetMemory: (memoryId: string, teamId?: string, scope?: 'personal' | 'team') =>
    ipcRenderer.invoke('agent:getMemory', memoryId, teamId, scope),
  agentGetMemoryIngestEvent: (
    sessionId: string,
    teamId?: string,
    eventId?: string,
    turnKey?: string,
  ) => ipcRenderer.invoke('agent:getMemoryIngestEvent', sessionId, teamId, eventId, turnKey),
  agentGetMemoryAttribution: (sessionId: string, teamId?: string, turnKey?: string) =>
    ipcRenderer.invoke('agent:getMemoryAttribution', sessionId, teamId, turnKey),
  agentGetMemoryScorecard: (teamId?: string, ids?: string[]) =>
    ipcRenderer.invoke('agent:getMemoryScorecard', teamId, ids),
  agentDeleteMemory: (
    memoryId: string,
    teamId?: string,
    scope?: 'personal' | 'team',
    reason?: string,
  ) => ipcRenderer.invoke('agent:deleteMemory', memoryId, teamId, scope, reason),
  agentRestoreMemory: (memoryId: string, teamId?: string, scope?: 'personal' | 'team') =>
    ipcRenderer.invoke('agent:restoreMemory', memoryId, teamId, scope),
  agentListAutoModeRules: () => ipcRenderer.invoke('agent:listAutoModeRules'),
  agentCreateAutoModeRule: (description: string) =>
    ipcRenderer.invoke('agent:createAutoModeRule', description),
  agentActivateAutoModeRule: (ruleId: string) =>
    ipcRenderer.invoke('agent:activateAutoModeRule', ruleId),
  agentDeleteAutoModeRule: (ruleId: string) =>
    ipcRenderer.invoke('agent:deleteAutoModeRule', ruleId),
  agentAddAutoModeSessionApproval: (sessionId: string, command: string) =>
    ipcRenderer.invoke('agent:addAutoModeSessionApproval', sessionId, command),
  agentGetAutoModeBypass: (sessionId: string) =>
    ipcRenderer.invoke('agent:getAutoModeBypass', sessionId),
  agentSetAutoModeBypass: (sessionId: string, bypass: boolean) =>
    ipcRenderer.invoke('agent:setAutoModeBypass', sessionId, bypass),
  agentApproveAutoModeCommand: (
    sessionId: string,
    toolCallId: string,
    scope: 'once' | 'session' | 'always',
    teamId?: string,
    ruleDescription?: string,
  ) =>
    ipcRenderer.invoke(
      'agent:approveAutoModeCommand',
      sessionId,
      toolCallId,
      scope,
      teamId,
      ruleDescription,
    ),
  agentDenyAutoModeCommand: (sessionId: string, toolCallId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:denyAutoModeCommand', sessionId, toolCallId, teamId),
  agentListPlans: (args: { teamId?: string; mine?: boolean; cursor?: string; limit?: number }) =>
    ipcRenderer.invoke('agent:listPlans', args),
  agentGetPlan: (planId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:getPlan', planId, teamId),
  agentUpdatePlan: (
    planId: string,
    patch: {
      status?:
        'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'cancelled'
      commandStatuses?: {
        stepIdx: number
        jobIdx: number
        cmdIdx: number
        status: 'pending' | 'running' | 'done' | 'failed'
      }[]
      commandResults?: {
        stepIdx: number
        jobIdx: number
        cmdIdx: number
        status: 'pending' | 'running' | 'done' | 'failed'
        stdout?: string
        stderr?: string
        exitCode?: number
        executedBy?: 'agent'
      }[]
      executionError?: string
    },
    teamId?: string,
  ) => ipcRenderer.invoke('agent:updatePlan', planId, patch, teamId),
  agentGetPlanApprovalPolicy: (teamId: string) =>
    ipcRenderer.invoke('agent:getPlanApprovalPolicy', teamId),
  agentUpdatePlanApprovalPolicy: (teamId: string, minimumOtherApprovals: number) =>
    ipcRenderer.invoke('agent:updatePlanApprovalPolicy', teamId, minimumOtherApprovals),
  agentRetryPlan: (planId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:retryPlan', planId, teamId),
  agentListTriggers: (teamId?: string) => ipcRenderer.invoke('agent:listTriggers', teamId),
  agentListTriggerGroups: (teamId?: string) =>
    ipcRenderer.invoke('agent:listTriggerGroups', teamId),
  agentUpdateTriggerGroup: (
    groupId: string,
    patch: {
      name?: string
      messageTemplate?: string
      enabled?: boolean
    },
    teamId: string,
  ) => ipcRenderer.invoke('agent:updateTriggerGroup', groupId, patch, teamId),
  agentTestFireTriggerGroup: (groupId: string, teamId: string) =>
    ipcRenderer.invoke('agent:testFireTriggerGroup', groupId, teamId),
  agentGetTrigger: (triggerId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:getTrigger', triggerId, teamId),
  agentCreateTrigger: (input: {
    name: string
    triggerType: 'cron' | 'webhook'
    messageTemplate: string
    cronExpression?: string
    teamId?: string
  }) => ipcRenderer.invoke('agent:createTrigger', input),
  agentUpdateTrigger: (
    triggerId: string,
    patch: {
      name?: string
      messageTemplate?: string
      cronExpression?: string
      enabled?: boolean
    },
    teamId?: string,
  ) => ipcRenderer.invoke('agent:updateTrigger', triggerId, patch, teamId),
  agentDeleteTrigger: (triggerId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:deleteTrigger', triggerId, teamId),
  agentTestFireTrigger: (triggerId: string, payload?: Record<string, unknown>, teamId?: string) =>
    ipcRenderer.invoke('agent:testFireTrigger', triggerId, payload, teamId),
  agentTransferTriggerExecutionPrincipal: (triggerId: string, userId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:transferTriggerExecutionPrincipal', triggerId, userId, teamId),
  agentTransferTriggerGroupExecutionPrincipal: (groupId: string, userId: string, teamId?: string) =>
    ipcRenderer.invoke('agent:transferTriggerGroupExecutionPrincipal', groupId, userId, teamId),
  agentGetTriggerSchedulerStatus: () => ipcRenderer.invoke('agent:getTriggerSchedulerStatus'),
  appOpenExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  appOpenSsh: (url: string) => ipcRenderer.invoke('app:openSsh', url),
  sshTerminalInput: (id: string, data: string) =>
    ipcRenderer.invoke('ssh-terminal:input', id, data),
  sshTerminalReplay: (id: string) => ipcRenderer.invoke('ssh-terminal:replay', id),
  sshTerminalClose: (id: string) => ipcRenderer.invoke('ssh-terminal:close', id),
  podExecStart: (
    id: string,
    ctx: string,
    ns: string,
    pod: string,
    container: string,
    opts?: { cols?: number; rows?: number; shell?: string },
  ) => ipcRenderer.invoke('pod-exec:start', id, ctx, ns, pod, container, opts),
  nodeExecStart: (id: string, ctx: string, node: string, opts?: { cols?: number; rows?: number }) =>
    ipcRenderer.invoke('node-exec:start', id, ctx, node, opts),
  podExecHasSession: (id: string) => ipcRenderer.invoke('pod-exec:has-session', id),
  podExecDetach: (id: string) => ipcRenderer.invoke('pod-exec:detach', id),
  podExecCloseTabScope: (tabId: string, scope: string | null) =>
    ipcRenderer.invoke('pod-exec:close-tab-scope', tabId, scope),
  podExecInput: (id: string, data: string) => ipcRenderer.invoke('pod-exec:input', id, data),
  podExecResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pod-exec:resize', id, cols, rows),
  podExecReplay: (id: string) => ipcRenderer.invoke('pod-exec:replay', id),
  podExecClose: (id: string) => ipcRenderer.invoke('pod-exec:close', id),
  onPodExecEvent: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload)

    ipcRenderer.on('pod-exec:event', handler)

    return () => ipcRenderer.off('pod-exec:event', handler)
  },
  onSshTerminalEvent: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload)

    ipcRenderer.on('ssh-terminal:event', handler)

    return () => ipcRenderer.off('ssh-terminal:event', handler)
  },
  onAgentEvent: (cb: (payload: { streamId: string; event: unknown }) => void) => {
    const handler = (_e: unknown, payload: { streamId: string; event: unknown }) => cb(payload)

    ipcRenderer.on('agent:event', handler)

    return () => ipcRenderer.off('agent:event', handler)
  },
}
