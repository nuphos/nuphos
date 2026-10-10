import type {
  AgentAuditConversationsPage,
  AgentAuditEventsPage,
  AgentAuditListArgs,
  AgentComplianceExportResult,
  AgentJournalResponse,
  AgentMemoryIngestEventPage,
  AgentMemoryItem,
  AgentMemoryPage,
  AgentMemoryScope,
  AgentMemoryScorecard,
  AutoModeRule,
} from './agent-audit-types.ts'
import type {
  AgentTrigger,
  AgentTriggerGroup,
  CreateAgentTriggerInput,
  DeleteAgentTriggerResult,
  TestAgentTriggerGroupResult,
  TestAgentTriggerResult,
  TriggerSchedulerStatus,
  UpdateAgentTriggerGroupInput,
  UpdateAgentTriggerInput,
} from './agent-trigger-types.ts'
import type {
  AgentConversationCredentialsResponse,
  AgentConversationDetail,
  AgentConversationMessagesPage,
  AgentConversationsPage,
  AgentCredentialOptions,
  AgentCredentialSelection,
  AgentPersistedMessage,
  AgentSlackThread,
  AgentStarterSuggestion,
} from './agent-types.ts'
import type { LocalSessionImportResult, LocalSessionSource } from './app-types.ts'
import type { Plan, PlanApprovalRequirement, PlanUpdatePatch, PlansPage } from './plan-types.ts'
import type {
  SessionConfigPick,
  SessionConfigSelection,
  SessionConfigState,
} from './session-config-types'
import type { CloudCliProvider, CloudCliProbe } from '../lib/cloudCli.ts'
import type { AgentProvider } from '../types/runtime.ts'

export type WindowAgentApi = {
  cloudProbeCliVersion(provider: CloudCliProvider, probeId?: string): Promise<string | null>
  cloudProbeCli(provider: CloudCliProvider): Promise<CloudCliProbe>
  agentMoveConversationRuntime(
    sessionId: string,
    teamId: string,
    runtimeId: string,
    mode: 'history' | 'workspace',
  ): Promise<{
    runtimeId: string
    runtimeLabel: string
    agentRuntime: AgentProvider
    mode: 'history' | 'workspace'
  }>
  agentImportLocalSession(args: {
    source: LocalSessionSource
    id: string
    teamId: string
    runtimeId: string
    agentRuntime: AgentProvider
  }): Promise<LocalSessionImportResult>
  agentGetSessionConfig(sessionId: string, teamId: string): Promise<SessionConfigState>
  agentSetSessionConfig(
    sessionId: string,
    teamId: string,
    selection: SessionConfigSelection,
  ): Promise<SessionConfigState>
  agentStart(args: {
    streamId: string
    sessionId: string
    teamId?: string
    messages: unknown[]
    baseIndex?: number
    locale?: string
    url?: string
    kubeContext?: string
    diagramId?: string
    resume?: boolean
    resumeFrom?: number
    continueAfterInterruption?: boolean
    resumeReason?: 'permission-decision' | 'approval-decision' | 'client-tool'
    credentialAccess?: AgentCredentialSelection
    /** Authorization mode for a conversation being created by this call. */
    permissionMode?: 'auto' | 'bypass'
    agentRuntime?: AgentProvider
    runtimeId?: string
    /** Model settings picked before this conversation existed. */
    initialSessionConfig?: SessionConfigPick
  }): Promise<void>
  agentNotifyStopped(args: {
    title: string
    body: string
    sessionId: string
    teamId?: string
  }): Promise<void>
  agentAbort(streamId: string): Promise<{
    status: 'local' | 'forwarded' | 'not_found' | 'unauthenticated' | 'failed'
    detail?: string
  }>
  agentReportFailure(streamId: string, payload: Record<string, unknown>): Promise<void>
  agentAbortClientTools(sessionId: string): Promise<void>
  agentExecuteClientTool(args: {
    sessionId: string
    toolCallId: string
    toolName: string
    input: unknown
  }): Promise<unknown>
  agentListConversations(
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
  ): Promise<AgentConversationsPage>
  agentRenameConversation(
    sessionId: string,
    title: string,
    teamId?: string,
  ): Promise<{ title: string }>
  agentSetConversationArchived(
    sessionId: string,
    archived: boolean,
    teamId?: string,
  ): Promise<{ ok: boolean; archived: boolean }>
  agentMarkConversationRead(
    sessionId: string,
    seq: number,
    teamId?: string,
  ): Promise<{ activitySeq: number; readSeq: number; unread: boolean }>
  agentCancelRuntime(sessionId: string, teamId?: string): Promise<{ ok: boolean; status: string }>
  agentSteerConversation(
    sessionId: string,
    text: string,
    teamId?: string,
    groupId?: string,
  ): Promise<{ ok: boolean; messageId: string; text?: string }>
  agentSlackPickup(
    sessionId: string,
    teamId?: string,
  ): Promise<{ status: 'bound' | 'already_bound'; slackThread: AgentSlackThread }>
  agentGetConversation(
    sessionId: string,
    teamId?: string,
    options?: { tail?: number; runtimeState?: 'omit' },
  ): Promise<AgentConversationDetail>
  agentGetConversationMessages(
    sessionId: string,
    args: { before: number; limit?: number },
    teamId?: string,
  ): Promise<AgentConversationMessagesPage>
  agentGetJournal(sessionId: string, teamId?: string): Promise<AgentJournalResponse>
  agentListJournalConversations(args: AgentAuditListArgs): Promise<AgentAuditConversationsPage>
  agentListJournalEvents(args: AgentAuditListArgs): Promise<AgentAuditEventsPage>
  agentExportJournal(args: AgentAuditListArgs): Promise<AgentComplianceExportResult>
  agentGetCredentialOptions(teamId?: string): Promise<AgentCredentialOptions>
  agentGetStarterSuggestions(args: {
    teamId?: string
    resources: string[]
    locale?: string
  }): Promise<{ suggestions: AgentStarterSuggestion[] }>
  agentUpdateConversationCredentials(args: {
    sessionId: string
    teamId?: string
    credentialAccess: AgentCredentialSelection
  }): Promise<AgentConversationCredentialsResponse>
  agentSyncConversationTranscript(args: {
    sessionId: string
    agentRuntime?: AgentProvider
    runtimeId?: string
    teamId?: string
    title: string
    messages: AgentPersistedMessage[]
    baseIndex?: number
  }): Promise<void>
  agentDeleteConversation(sessionId: string, teamId?: string): Promise<void>
  agentSendMessageFeedback(args: {
    sessionId: string
    messageId: string
    rating: 'up' | 'down' | null
    comment?: string
    teamId?: string
  }): Promise<void>
  agentListMemories(
    cursor?: string,
    limit?: number,
    teamId?: string,
    scope?: AgentMemoryScope,
    state?: 'live' | 'removed',
  ): Promise<AgentMemoryPage>
  agentGetMemory(
    memoryId: string,
    teamId?: string,
    scope?: AgentMemoryScope,
  ): Promise<AgentMemoryItem>
  agentGetMemoryIngestEvent(
    sessionId: string,
    teamId?: string,
    eventId?: string,
    turnKey?: string,
  ): Promise<AgentMemoryIngestEventPage>
  agentGetMemoryAttribution(
    sessionId: string,
    teamId?: string,
    turnKey?: string,
  ): Promise<{
    rows: { memoryId: string; tier: string; turnKey: string }[]
  }>
  agentGetMemoryScorecard(teamId?: string, ids?: string[]): Promise<AgentMemoryScorecard>
  agentDeleteMemory(
    memoryId: string,
    teamId?: string,
    scope?: AgentMemoryScope,
    reason?: string,
  ): Promise<void>
  agentRestoreMemory(memoryId: string, teamId?: string, scope?: AgentMemoryScope): Promise<void>
  agentListAutoModeRules(): Promise<{ enabled: boolean; rules: AutoModeRule[] }>
  agentCreateAutoModeRule(description: string): Promise<{ rule: AutoModeRule }>
  agentActivateAutoModeRule(ruleId: string): Promise<{ ok: boolean }>
  agentDeleteAutoModeRule(ruleId: string): Promise<void>
  agentAddAutoModeSessionApproval(sessionId: string, command: string): Promise<{ ok: boolean }>
  agentGetAutoModeBypass(sessionId: string): Promise<{ enabled: boolean; bypass: boolean }>
  agentSetAutoModeBypass(
    sessionId: string,
    bypass: boolean,
  ): Promise<{ ok: boolean; bypass: boolean }>
  agentApproveAutoModeCommand(
    sessionId: string,
    toolCallId: string,
    scope: 'once' | 'session' | 'always',
    teamId?: string,
    ruleDescription?: string,
  ): Promise<{ ok: boolean }>
  agentDenyAutoModeCommand(sessionId: string, toolCallId: string, teamId?: string): Promise<void>
  agentListPlans(args: {
    teamId?: string
    mine?: boolean
    cursor?: string
    limit?: number
  }): Promise<PlansPage>
  agentGetPlan(planId: string, teamId?: string): Promise<Plan>
  agentUpdatePlan(planId: string, patch: PlanUpdatePatch, teamId?: string): Promise<Plan>
  agentGetPlanApprovalPolicy(teamId: string): Promise<PlanApprovalRequirement>
  agentUpdatePlanApprovalPolicy(
    teamId: string,
    minimumOtherApprovals: number,
  ): Promise<PlanApprovalRequirement>
  agentRetryPlan(planId: string, teamId?: string): Promise<Plan>
  agentListTriggers(teamId?: string): Promise<AgentTrigger[]>
  agentListTriggerGroups(teamId?: string): Promise<AgentTriggerGroup[]>
  agentUpdateTriggerGroup(
    groupId: string,
    patch: UpdateAgentTriggerGroupInput,
    teamId: string,
  ): Promise<AgentTriggerGroup>
  agentTestFireTriggerGroup(groupId: string, teamId: string): Promise<TestAgentTriggerGroupResult>
  agentGetTrigger(triggerId: string, teamId?: string): Promise<AgentTrigger>
  agentCreateTrigger(input: CreateAgentTriggerInput): Promise<AgentTrigger>
  agentUpdateTrigger(
    triggerId: string,
    patch: UpdateAgentTriggerInput,
    teamId?: string,
  ): Promise<AgentTrigger>
  agentDeleteTrigger(triggerId: string, teamId?: string): Promise<DeleteAgentTriggerResult>
  agentTestFireTrigger(
    triggerId: string,
    payload?: Record<string, unknown>,
    teamId?: string,
  ): Promise<TestAgentTriggerResult>
  agentTransferTriggerExecutionPrincipal(
    triggerId: string,
    userId: string,
    teamId?: string,
  ): Promise<AgentTrigger>
  agentTransferTriggerGroupExecutionPrincipal(
    groupId: string,
    userId: string,
    teamId?: string,
  ): Promise<AgentTriggerGroup>
  agentGetTriggerSchedulerStatus(): Promise<TriggerSchedulerStatus>
}
