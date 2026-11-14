import { receiveAgentAvatars } from '../lib/agentAvatarChoices.ts'
import { publishRuntimeStates } from '../lib/agentRuntimeStates.ts'
import { receiveConversationReadStates } from '../lib/agentUnreadSessions.ts'
import { queryClient } from '../lib/query/client.ts'
import { queryKeys } from '../lib/query/keys.ts'
import { receiveSubAgents } from '../lib/subAgentIds.ts'

import type { AgentAuditListArgs, AgentMemoryScope } from './agent-audit-types.ts'
import type { DecisionAnswer } from './agent-chat-types.ts'
import type { UpdateAgentTriggerInput } from './agent-trigger-types.ts'
import type {
  AgentCredentialSelection,
  AgentPersistedMessage,
  GeneralAccess,
} from './agent-types.ts'
import type { LocalSessionSource } from './app-types.ts'
import type { PlanUpdatePatch } from './plan-types.ts'
import type { CloudCliProvider } from '../lib/cloudCli.ts'
import type { AgentProvider } from '../types/runtime.ts'

export const agentApi = {
  agentResolveDecision: (
    sessionId: string,
    toolCallId: string,
    teamId?: string,
    resolution?: 'answered' | 'dismissed',
  ) => window.api.agentResolveDecision(sessionId, toolCallId, teamId, resolution),
  agentAnswerDecision: (
    sessionId: string,
    requestId: string,
    teamId: string | undefined,
    answer: DecisionAnswer,
  ) => window.api.agentAnswerDecision(sessionId, requestId, teamId, answer),
  agentGetSessionResources: (sessionId: string, teamId: string) =>
    window.api.agentGetSessionResources(sessionId, teamId),
  agentUnlinkSessionResource: (sessionId: string, teamId: string, resourceId: string) =>
    window.api.agentUnlinkSessionResource(sessionId, teamId, resourceId),
  cloudProbeCliVersion: (provider: CloudCliProvider, probeId?: string) =>
    window.api.cloudProbeCliVersion(provider, probeId),
  cloudProbeCli: (provider: CloudCliProvider) => window.api.cloudProbeCli(provider),
  agentMoveConversationRuntime: (
    sessionId: string,
    teamId: string,
    runtimeId: string,
    grantComputerUse?: boolean,
  ) => window.api.agentMoveConversationRuntime(sessionId, teamId, runtimeId, grantComputerUse),
  agentCheckConversationMove: (sessionId: string, teamId: string, runtimeId: string) =>
    window.api.agentCheckConversationMove(sessionId, teamId, runtimeId),
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
    grantComputerUse = false,
  ) => window.api.agentInviteConversationParticipants(sessionId, teamId, userIds, grantComputerUse),
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
      pendingDecision?: boolean
      /** Channels instead of agent conversations; lists never mix the two. */
      kind?: 'channel'
    },
  ) => {
    const requestedAt = Date.now()
    const page = await window.api.agentListConversations(teamId, options)

    publishRuntimeStates(
      page.conversations.flatMap((conversation) =>
        conversation.runtimeState
          ? [[conversation.sessionId, conversation.runtimeState] as const]
          : [],
      ),
    )
    receiveConversationReadStates(page.conversations)
    receiveAgentAvatars(page.conversations, requestedAt)
    receiveSubAgents(page.conversations)

    return page
  },
  agentRenameConversation: (sessionId: string, title: string, teamId?: string) =>
    window.api.agentRenameConversation(sessionId, title, teamId),
  agentSetConversationAvatar: (sessionId: string, avatar: string | null, teamId?: string) =>
    window.api.agentSetConversationAvatar(sessionId, avatar, teamId),
  agentSetConversationArchived: (sessionId: string, archived: boolean, teamId?: string) =>
    window.api.agentSetConversationArchived(sessionId, archived, teamId),
  agentSetConversationWatched: (sessionId: string, watching: boolean, teamId?: string) =>
    window.api.agentSetConversationWatched(sessionId, watching, teamId),
  agentUnlinkConversationParent: (sessionId: string, teamId?: string) =>
    window.api.agentUnlinkConversationParent(sessionId, teamId),
  agentRecordFork: (sessionId: string, forkSessionId: string, teamId?: string) =>
    window.api.agentRecordFork(sessionId, forkSessionId, teamId),
  agentRecordEditFork: (sessionId: string, forkSessionId: string, teamId?: string) =>
    window.api.agentRecordEditFork(sessionId, forkSessionId, teamId),
  agentCancelRuntime: (sessionId: string, teamId?: string) =>
    window.api.agentCancelRuntime(sessionId, teamId),
  agentRetractMessage: (sessionId: string, messageId: string, teamId?: string) =>
    window.api.agentRetractMessage(sessionId, messageId, teamId),
  agentSteerConversation: (
    sessionId: string,
    text: string,
    teamId?: string,
    groupId?: string,
    queuedId?: string,
  ) => window.api.agentSteerConversation(sessionId, text, teamId, groupId, queuedId),
  agentSaveSecret: (sessionId: string, name: string, value: string, teamId?: string) =>
    window.api.agentSaveSecret(sessionId, name, value, teamId),
  agentListQueue: (sessionId: string, teamId?: string) =>
    window.api.agentListQueue(sessionId, teamId),
  agentUnqueueMessage: (sessionId: string, messageId: string, teamId?: string) =>
    window.api.agentUnqueueMessage(sessionId, messageId, teamId),
  agentSlackPickup: (sessionId: string, teamId?: string) =>
    window.api.agentSlackPickup(sessionId, teamId),
  agentGetConversation: async (
    sessionId: string,
    teamId?: string,
    options?: { tail?: number; runtimeState?: 'omit'; messages?: 'omit' },
  ) => {
    const requestedAt = Date.now()
    const detail = await window.api.agentGetConversation(sessionId, teamId, options)

    receiveConversationReadStates([detail], true)
    receiveAgentAvatars([detail], requestedAt)
    // Only a parent it names is trusted here; the list says when one is gone.
    if (detail.parentSessionId) receiveSubAgents([detail])

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
  agentUpdateConversationCredentials: (args: {
    sessionId: string
    teamId?: string
    credentialAccess: AgentCredentialSelection
  }) => window.api.agentUpdateConversationCredentials(args),
  agentSyncConversationTranscript: async (args: {
    agentRuntime?: AgentProvider
    runtimeId?: string
    sessionId: string
    teamId?: string
    title: string
    messages: AgentPersistedMessage[]
    baseIndex?: number
    import?: boolean
  }) => {
    await window.api.agentSyncConversationTranscript(args)
    if (args.import && args.teamId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentSessions(args.teamId) })
  },
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
  agentGetMemoryIngestEvent: (sessionId: string, teamId?: string, eventId?: string) =>
    window.api.agentGetMemoryIngestEvent(sessionId, teamId, eventId),
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
  agentGetAutoModeBypass: (sessionId: string) => window.api.agentGetAutoModeBypass(sessionId),
  agentSetAutoModeBypass: (sessionId: string, bypass: boolean) =>
    window.api.agentSetAutoModeBypass(sessionId, bypass),
  agentListPlans: (args: { teamId?: string; mine?: boolean; cursor?: string; limit?: number }) =>
    window.api.agentListPlans(args),
  agentGetPlan: (planId: string, teamId?: string) => window.api.agentGetPlan(planId, teamId),
  agentUpdatePlan: (planId: string, patch: PlanUpdatePatch, teamId?: string) =>
    window.api.agentUpdatePlan(planId, patch, teamId),
  agentGetPlanApprovalPolicy: (teamId: string) => window.api.agentGetPlanApprovalPolicy(teamId),
  agentUpdatePlanApprovalPolicy: (teamId: string, minimumOtherApprovals: number) =>
    window.api.agentUpdatePlanApprovalPolicy(teamId, minimumOtherApprovals),
  agentListTriggers: (teamId?: string, targetSessionId?: string) =>
    window.api.agentListTriggers(teamId, targetSessionId),
  agentGetTrigger: (triggerId: string, teamId?: string) =>
    window.api.agentGetTrigger(triggerId, teamId),
  agentUpdateTrigger: (triggerId: string, patch: UpdateAgentTriggerInput, teamId?: string) =>
    window.api.agentUpdateTrigger(triggerId, patch, teamId),
  agentDeleteTrigger: (triggerId: string, teamId?: string) =>
    window.api.agentDeleteTrigger(triggerId, teamId),
}
