import { publishRuntimeStates } from '../lib/agentRuntimeStates.ts'
import { receiveConversationReadStates } from '../lib/agentUnreadSessions.ts'

import type { AgentAuditListArgs, AgentMemoryScope } from './agent-audit-types.ts'
import type {
  CreateAgentTriggerInput,
  UpdateAgentTriggerGroupInput,
  UpdateAgentTriggerInput,
} from './agent-trigger-types.ts'
import type {
  AgentCredentialSelection,
  AgentPersistedMessage,
  GeneralAccess,
  ParticipantRole,
} from './agent-types.ts'
import type { LocalSessionSource } from './app-types.ts'
import type { PlanUpdatePatch } from './plan-types.ts'
import type { CloudCliProvider } from '../lib/cloudCli.ts'
import type { AgentProvider } from '../types/runtime.ts'

export const agentApi = {
  cloudProbeCliVersion: (provider: CloudCliProvider, probeId?: string) =>
    window.api.cloudProbeCliVersion(provider, probeId),
  cloudProbeCli: (provider: CloudCliProvider) => window.api.cloudProbeCli(provider),
  agentMoveConversationRuntime: (
    sessionId: string,
    teamId: string,
    runtimeId: string,
    mode: 'history' | 'workspace',
  ) => window.api.agentMoveConversationRuntime(sessionId, teamId, runtimeId, mode),
  agentImportLocalSession: (args: {
    source: LocalSessionSource
    id: string
    teamId: string
    runtimeId: string
    agentRuntime: AgentProvider
  }) => window.api.agentImportLocalSession(args),
  agentGetSessionConfig: (sessionId: string, teamId: string) =>
    window.api.agentGetSessionConfig(sessionId, teamId),
  agentGetConversationParticipants: (sessionId: string, teamId?: string) =>
    window.api.agentGetConversationParticipants(sessionId, teamId),
  agentInviteConversationParticipants: (
    sessionId: string,
    teamId: string,
    userIds: string[],
    role: ParticipantRole = 'reply',
  ) => window.api.agentInviteConversationParticipants(sessionId, teamId, userIds, role),
  agentSetConversationParticipantRole: (
    sessionId: string,
    teamId: string,
    userId: string,
    role: ParticipantRole,
  ) => window.api.agentSetConversationParticipantRole(sessionId, teamId, userId, role),
  agentSetConversationGeneralAccess: (
    sessionId: string,
    teamId: string,
    generalAccess: GeneralAccess,
  ) => window.api.agentSetConversationGeneralAccess(sessionId, teamId, generalAccess),
  agentRemoveConversationParticipant: (sessionId: string, teamId: string, userId: string) =>
    window.api.agentRemoveConversationParticipant(sessionId, teamId, userId),
  agentSetSessionConfig: (
    sessionId: string,
    teamId: string,
    selection: { configId: string; value: string },
  ) => window.api.agentSetSessionConfig(sessionId, teamId, selection),
  agentReportFailure: (streamId: string, payload: Record<string, unknown>) =>
    window.api.agentReportFailure(streamId, payload),
  agentListConversations: async (
    teamId: string,
    options?: {
      cursor?: string
      limit?: number
      /** 'shared' lists team sessions the viewer joined but does not own. */
      scope?: 'mine' | 'team' | 'shared'
      ownerId?: string
      /** A Trigger's runs. Omitted lists Chats, which excludes them. */
      triggerIds?: string[]
      search?: string
      archived?: 'exclude' | 'only'
      sort?: 'activity' | 'created' | 'archived'
    },
  ) => {
    const observedAt = performance.now()
    const result = await window.api.agentListConversations(teamId, options)

    const page = {
      ...result,
      conversations: result.conversations.map((conversation) => ({
        ...conversation,
        runtimeState: {
          ...(conversation.runtimeState ?? { state: 'unsupported' as const }),
          observedAt,
        },
      })),
    }

    publishRuntimeStates(
      page.conversations.map(
        (conversation) => [conversation.sessionId, conversation.runtimeState] as const,
      ),
    )
    receiveConversationReadStates(page.conversations)

    return page
  },
  agentRenameConversation: (sessionId: string, title: string, teamId?: string) =>
    window.api.agentRenameConversation(sessionId, title, teamId),
  agentSetConversationArchived: (sessionId: string, archived: boolean, teamId?: string) =>
    window.api.agentSetConversationArchived(sessionId, archived, teamId),
  agentCancelRuntime: (sessionId: string, teamId?: string) =>
    window.api.agentCancelRuntime(sessionId, teamId),
  agentSteerConversation: (sessionId: string, text: string, teamId?: string, groupId?: string) =>
    window.api.agentSteerConversation(sessionId, text, teamId, groupId),
  agentSlackPickup: (sessionId: string, teamId?: string) =>
    window.api.agentSlackPickup(sessionId, teamId),
  agentGetConversation: async (
    sessionId: string,
    teamId?: string,
    options?: { tail?: number; runtimeState?: 'omit' },
  ) => {
    const detail = await window.api.agentGetConversation(sessionId, teamId, options)

    receiveConversationReadStates([detail], true)

    return detail
  },
  agentMarkConversationRead: (sessionId: string, seq: number, teamId?: string) =>
    window.api.agentMarkConversationRead(sessionId, seq, teamId),
  agentGetConversationMessages: (
    sessionId: string,
    args: { before: number; limit?: number },
    teamId?: string,
  ) => window.api.agentGetConversationMessages(sessionId, args, teamId),
  agentGetJournal: (sessionId: string, teamId?: string) =>
    window.api.agentGetJournal(sessionId, teamId),
  agentListJournalConversations: (args: AgentAuditListArgs) =>
    window.api.agentListJournalConversations(args),
  agentListJournalEvents: (args: AgentAuditListArgs) => window.api.agentListJournalEvents(args),
  agentExportJournal: (args: AgentAuditListArgs) => window.api.agentExportJournal(args),
  agentGetCredentialOptions: (teamId?: string) => window.api.agentGetCredentialOptions(teamId),
  agentGetStarterSuggestions: (args: { teamId?: string; resources: string[]; locale?: string }) =>
    window.api.agentGetStarterSuggestions(args),
  agentUpdateConversationCredentials: (args: {
    sessionId: string
    teamId?: string
    credentialAccess: AgentCredentialSelection
  }) => window.api.agentUpdateConversationCredentials(args),
  agentSyncConversationTranscript: (args: {
    agentRuntime?: AgentProvider
    runtimeId?: string
    sessionId: string
    teamId?: string
    title: string
    messages: AgentPersistedMessage[]
    baseIndex?: number
  }) => window.api.agentSyncConversationTranscript(args),
  agentDeleteConversation: (sessionId: string, teamId?: string) =>
    window.api.agentDeleteConversation(sessionId, teamId),
  agentSendMessageFeedback: (args: {
    sessionId: string
    messageId: string
    rating: 'up' | 'down' | null
    comment?: string
    teamId?: string
  }) => window.api.agentSendMessageFeedback(args),
  agentListMemories: (
    cursor?: string,
    limit?: number,
    teamId?: string,
    scope?: AgentMemoryScope,
    state?: 'live' | 'removed',
  ) => window.api.agentListMemories(cursor, limit, teamId, scope, state),
  agentGetMemory: (memoryId: string, teamId?: string, scope?: AgentMemoryScope) =>
    window.api.agentGetMemory(memoryId, teamId, scope),
  agentGetMemoryIngestEvent: (
    sessionId: string,
    teamId?: string,
    eventId?: string,
    turnKey?: string,
  ) => window.api.agentGetMemoryIngestEvent(sessionId, teamId, eventId, turnKey),
  agentGetMemoryAttribution: (sessionId: string, teamId?: string, turnKey?: string) =>
    window.api.agentGetMemoryAttribution(sessionId, teamId, turnKey),
  agentGetMemoryScorecard: (teamId?: string, ids?: string[]) =>
    window.api.agentGetMemoryScorecard(teamId, ids),
  agentDeleteMemory: (
    memoryId: string,
    teamId?: string,
    scope?: AgentMemoryScope,
    reason?: string,
  ) => window.api.agentDeleteMemory(memoryId, teamId, scope, reason),
  agentRestoreMemory: (memoryId: string, teamId?: string, scope?: AgentMemoryScope) =>
    window.api.agentRestoreMemory(memoryId, teamId, scope),
  agentListAutoModeRules: () => window.api.agentListAutoModeRules(),
  agentCreateAutoModeRule: (description: string) => window.api.agentCreateAutoModeRule(description),
  agentActivateAutoModeRule: (ruleId: string) => window.api.agentActivateAutoModeRule(ruleId),
  agentDeleteAutoModeRule: (ruleId: string) => window.api.agentDeleteAutoModeRule(ruleId),
  agentAddAutoModeSessionApproval: (sessionId: string, command: string) =>
    window.api.agentAddAutoModeSessionApproval(sessionId, command),
  agentGetAutoModeBypass: (sessionId: string) => window.api.agentGetAutoModeBypass(sessionId),
  agentSetAutoModeBypass: (sessionId: string, bypass: boolean) =>
    window.api.agentSetAutoModeBypass(sessionId, bypass),
  agentApproveAutoModeCommand: (
    sessionId: string,
    toolCallId: string,
    scope: 'once' | 'session' | 'always',
    teamId?: string,
    ruleDescription?: string,
  ) =>
    window.api.agentApproveAutoModeCommand(sessionId, toolCallId, scope, teamId, ruleDescription),
  agentDenyAutoModeCommand: (sessionId: string, toolCallId: string, teamId?: string) =>
    window.api.agentDenyAutoModeCommand(sessionId, toolCallId, teamId),
  agentListPlans: (args: { teamId?: string; mine?: boolean; cursor?: string; limit?: number }) =>
    window.api.agentListPlans(args),
  agentGetPlan: (planId: string, teamId?: string) => window.api.agentGetPlan(planId, teamId),
  agentUpdatePlan: (planId: string, patch: PlanUpdatePatch, teamId?: string) =>
    window.api.agentUpdatePlan(planId, patch, teamId),
  agentGetPlanApprovalPolicy: (teamId: string) => window.api.agentGetPlanApprovalPolicy(teamId),
  agentUpdatePlanApprovalPolicy: (teamId: string, minimumOtherApprovals: number) =>
    window.api.agentUpdatePlanApprovalPolicy(teamId, minimumOtherApprovals),
  agentRetryPlan: (planId: string, teamId?: string) => window.api.agentRetryPlan(planId, teamId),
  agentListTriggers: (teamId?: string) => window.api.agentListTriggers(teamId),
  agentListTriggerGroups: (teamId?: string) => window.api.agentListTriggerGroups(teamId),
  agentUpdateTriggerGroup: (groupId: string, patch: UpdateAgentTriggerGroupInput, teamId: string) =>
    window.api.agentUpdateTriggerGroup(groupId, patch, teamId),
  agentTestFireTriggerGroup: (groupId: string, teamId: string) =>
    window.api.agentTestFireTriggerGroup(groupId, teamId),
  agentGetTrigger: (triggerId: string, teamId?: string) =>
    window.api.agentGetTrigger(triggerId, teamId),
  agentCreateTrigger: (input: CreateAgentTriggerInput) => window.api.agentCreateTrigger(input),
  agentUpdateTrigger: (triggerId: string, patch: UpdateAgentTriggerInput, teamId?: string) =>
    window.api.agentUpdateTrigger(triggerId, patch, teamId),
  agentDeleteTrigger: (triggerId: string, teamId?: string) =>
    window.api.agentDeleteTrigger(triggerId, teamId),
  agentTestFireTrigger: (triggerId: string, payload?: Record<string, unknown>, teamId?: string) =>
    window.api.agentTestFireTrigger(triggerId, payload, teamId),
  agentTransferTriggerExecutionPrincipal: (triggerId: string, userId: string, teamId?: string) =>
    window.api.agentTransferTriggerExecutionPrincipal(triggerId, userId, teamId),
  agentTransferTriggerGroupExecutionPrincipal: (groupId: string, userId: string, teamId?: string) =>
    window.api.agentTransferTriggerGroupExecutionPrincipal(groupId, userId, teamId),
  agentGetTriggerSchedulerStatus: () => window.api.agentGetTriggerSchedulerStatus(),
}
