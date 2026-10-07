import { BrowserWindow, dialog } from 'electron'

import * as agent from '../agent'
import { writeComplianceExportZip } from '../complianceExport'

import type { IpcMainInvokeEvent } from 'electron'

export const agentChannels = {
  'agent:getSessionConfig': (_e: unknown, sessionId: string, teamId: string) =>
    agent.getSessionConfig(sessionId, teamId),
  'agent:setSessionConfig': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    selection: { configId: string; value: string },
  ) => agent.setSessionConfig(sessionId, teamId, selection),
  'agent:start': (
    e: IpcMainInvokeEvent,
    args: {
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
      credentialAccess?: agent.AgentCredentialSelection
    },
  ) => {
    void agent.startChat(args).catch((err: unknown) => {
      // The window may be gone; sending to destroyed WebContents would reject.
      if (e.sender.isDestroyed()) return
      const message = err instanceof Error ? err.message : String(err)

      e.sender.send('agent:event', {
        streamId: args.streamId,
        event: { type: 'error', error: message },
      })
      e.sender.send('agent:event', { streamId: args.streamId, event: { type: 'end' } })
    })
  },
  'agent:notifyStopped': (
    e: IpcMainInvokeEvent,
    args: { title: string; body: string; sessionId: string; teamId?: string },
  ) => agent.notifyAgentStopped({ ...args, parentWindow: BrowserWindow.fromWebContents(e.sender) }),
  'agent:abort': (_e: unknown, streamId: string) => agent.abortChat(streamId),
  'agent:reportFailure': (_e: unknown, streamId: string, payload: Record<string, unknown>) =>
    agent.reportFailure(streamId, payload),
  'agent:abortClientTools': (_e: unknown, sessionId: string) => agent.abortClientTools(sessionId),
  'agent:executeClientTool': (
    e: IpcMainInvokeEvent,
    args: { sessionId: string; toolCallId: string; toolName: string; input: unknown },
  ) => agent.executeClientTool({ ...args, parentWindow: BrowserWindow.fromWebContents(e.sender) }),
  'agent:listConversations': (
    _e: unknown,
    teamId: string,
    options?: {
      cursor?: string
      limit?: number
      scope?: agent.ConversationsScope
      ownerId?: string
      triggerIds?: string[]
      search?: string
      archived?: agent.ConversationsArchivedFilter
      sort?: agent.ConversationsSort
    },
  ) => agent.listConversations(teamId, options),
  'agent:moveConversationRuntime': (
    _e: unknown,
    sessionId: string,
    teamId: string,
    runtimeId: string,
    mode: 'history' | 'workspace',
  ) => agent.moveConversationRuntime(sessionId, teamId, runtimeId, mode),
  'agent:renameConversation': (_e: unknown, sessionId: string, title: string, teamId?: string) =>
    agent.renameConversation(sessionId, title, teamId),
  'agent:setConversationArchived': (
    _e: unknown,
    sessionId: string,
    archived: boolean,
    teamId?: string,
  ) => agent.setConversationArchived(sessionId, archived, teamId),
  'agent:cancelRuntime': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.cancelRuntime(sessionId, teamId),
  'agent:steerConversation': (_e: unknown, sessionId: string, text: string, teamId?: string) =>
    agent.steerConversation(sessionId, text, teamId),
  'agent:slackPickup': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.pickUpConversationInSlack(sessionId, teamId),
  'agent:getConversation': (
    _e: unknown,
    sessionId: string,
    teamId?: string,
    options?: { tail?: number; runtimeState?: 'omit' },
  ) => agent.getConversation(sessionId, teamId, options),
  'agent:getConversationMessages': (
    _e: unknown,
    sessionId: string,
    args: { before: number; limit?: number },
    teamId?: string,
  ) => agent.getConversationMessages(sessionId, args, teamId),
  'agent:getJournal': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.getJournal(sessionId, teamId),
  'agent:listJournalConversations': (_e: unknown, args: agent.AgentAuditListArgs) =>
    agent.listJournalConversations(args ?? {}),
  'agent:listJournalEvents': (_e: unknown, args: agent.AgentAuditListArgs) =>
    agent.listJournalEvents(args ?? {}),
  'agent:exportJournal': async (e: IpcMainInvokeEvent, args: agent.AgentAuditListArgs) => {
    const stamp = new Date()
      .toISOString()
      .replaceAll(':', '-')
      .replace(/\.\d{3}Z$/, 'Z')
    const parentWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showSaveDialog(
      parentWindow && !parentWindow.isDestroyed() ? parentWindow : (undefined as never),
      {
        title: 'Export compliance audit records',
        defaultPath: `nuphos-compliance-audit-${stamp}.zip`,
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      },
    )

    if (result.canceled || !result.filePath) return { saved: false as const }
    const bundle = await agent.getComplianceExport(args ?? {})
    const output = await writeComplianceExportZip(bundle, result.filePath)

    return {
      saved: true as const,
      path: result.filePath,
      sessionCount: bundle.selection.sessionCount,
      eventCount: bundle.selection.agentEventCount + bundle.selection.resourceEventCount,
      fileCount: output.fileCount,
    }
  },
  'agent:getCredentialOptions': (_e: unknown, teamId?: string) =>
    agent.getCredentialOptions(teamId),
  'agent:getStarterSuggestions': (
    _e: unknown,
    args: { teamId?: string; resources: string[]; locale?: string },
  ) => agent.getStarterSuggestions(args),
  'agent:updateConversationCredentials': (
    _e: unknown,
    args: {
      sessionId: string
      teamId?: string
      credentialAccess: agent.AgentCredentialSelection
    },
  ) => agent.updateConversationCredentials(args),
  'agent:syncConversationTranscript': (
    _e: unknown,
    args: {
      sessionId: string
      teamId?: string
      title: string
      messages: {
        id: string
        role: 'user' | 'assistant'
        parts: unknown[]
      }[]
      baseIndex?: number
    },
  ) => agent.syncConversationTranscript(args),
  'agent:deleteConversation': (_e: unknown, sessionId: string, teamId?: string) =>
    agent.deleteConversation(sessionId, teamId),
  'agent:sendMessageFeedback': (
    _e: unknown,
    args: {
      sessionId: string
      messageId: string
      rating: 'up' | 'down' | null
      comment?: string
      teamId?: string
    },
  ) => agent.sendMessageFeedback(args),
  'agent:listMemories': (
    _e: unknown,
    cursor?: string,
    limit?: number,
    teamId?: string,
    scope?: agent.MemoryScope,
    state?: 'live' | 'removed',
  ) => agent.listMemories(cursor, limit, teamId, scope, state),
  'agent:getMemory': (_e: unknown, memoryId: string, teamId?: string, scope?: agent.MemoryScope) =>
    agent.getMemory(memoryId, teamId, scope),
  'agent:getMemoryIngestEvent': (
    _e: unknown,
    sessionId: string,
    teamId?: string,
    eventId?: string,
    turnKey?: string,
  ) => agent.getMemoryIngestEvent(sessionId, teamId, eventId, turnKey),
  'agent:getMemoryAttribution': (
    _e: unknown,
    sessionId: string,
    teamId?: string,
    turnKey?: string,
  ) => agent.getMemoryAttribution(sessionId, teamId, turnKey),
  'agent:getMemoryScorecard': (_e: unknown, teamId?: string, ids?: string[]) =>
    agent.getMemoryScorecard(teamId, ids),
  'agent:deleteMemory': (
    _e: unknown,
    memoryId: string,
    teamId?: string,
    scope?: agent.MemoryScope,
    reason?: string,
  ) => agent.deleteMemory(memoryId, teamId, scope, reason),
  'agent:restoreMemory': (
    _e: unknown,
    memoryId: string,
    teamId?: string,
    scope?: agent.MemoryScope,
  ) => agent.restoreMemory(memoryId, teamId, scope),
  'agent:listPlans': (
    _e: unknown,
    args: { teamId?: string; mine?: boolean; cursor?: string; limit?: number },
  ) => agent.listPlans(args ?? {}),
  'agent:getPlan': (_e: unknown, planId: string, teamId?: string) => agent.getPlan(planId, teamId),
  'agent:updatePlan': (
    _e: unknown,
    planId: string,
    patch: agent.PlanUpdatePatch,
    teamId?: string,
  ) => agent.updatePlan(planId, patch, teamId),
  'agent:getPlanApprovalPolicy': (_e: unknown, teamId: string) =>
    agent.getPlanApprovalPolicy(teamId),
  'agent:updatePlanApprovalPolicy': (_e: unknown, teamId: string, minimumOtherApprovals: number) =>
    agent.updatePlanApprovalPolicy(teamId, minimumOtherApprovals),
  'agent:retryPlan': (_e: unknown, planId: string, teamId?: string) =>
    agent.retryPlan(planId, teamId),
  'agent:listTriggers': (_e: unknown, teamId?: string) => agent.listAgentTriggers(teamId),
  'agent:listTriggerGroups': (_e: unknown, teamId?: string) => agent.listAgentTriggerGroups(teamId),
  'agent:updateTriggerGroup': (
    _e: unknown,
    groupId: string,
    patch: agent.UpdateAgentTriggerGroupInput,
    teamId: string,
  ) => agent.updateAgentTriggerGroup(groupId, patch, teamId),
  'agent:testFireTriggerGroup': (_e: unknown, groupId: string, teamId: string) =>
    agent.testFireAgentTriggerGroup(groupId, teamId),
  'agent:getTrigger': (_e: unknown, triggerId: string, teamId?: string) =>
    agent.getAgentTrigger(triggerId, teamId),
  'agent:createTrigger': (_e: unknown, input: agent.CreateAgentTriggerInput) =>
    agent.createAgentTrigger(input),
  'agent:updateTrigger': (
    _e: unknown,
    triggerId: string,
    patch: agent.UpdateAgentTriggerInput,
    teamId?: string,
  ) => agent.updateAgentTrigger(triggerId, patch, teamId),
  'agent:deleteTrigger': (_e: unknown, triggerId: string, teamId?: string) =>
    agent.deleteAgentTrigger(triggerId, teamId),
  'agent:testFireTrigger': (
    _e: unknown,
    triggerId: string,
    payload?: Record<string, unknown>,
    teamId?: string,
  ) => agent.testFireAgentTrigger(triggerId, payload, teamId),
  'agent:transferTriggerExecutionPrincipal': (
    _e: unknown,
    triggerId: string,
    userId: string,
    teamId?: string,
  ) => agent.transferAgentTriggerExecutionPrincipal(triggerId, userId, teamId),
  'agent:transferTriggerGroupExecutionPrincipal': (
    _e: unknown,
    groupId: string,
    userId: string,
    teamId?: string,
  ) => agent.transferAgentTriggerGroupExecutionPrincipal(groupId, userId, teamId),
  'agent:getTriggerSchedulerStatus': () => agent.getTriggerSchedulerStatus(),
  'agent:listAutoModeRules': () => agent.listAutoModeRules(),
  'agent:createAutoModeRule': (_e: unknown, description: string) =>
    agent.createAutoModeRule(description),
  'agent:activateAutoModeRule': (_e: unknown, ruleId: string) => agent.activateAutoModeRule(ruleId),
  'agent:deleteAutoModeRule': (_e: unknown, ruleId: string) => agent.deleteAutoModeRule(ruleId),
  'agent:addAutoModeSessionApproval': (_e: unknown, sessionId: string, command: string) =>
    agent.addAutoModeSessionApproval(sessionId, command),
  'agent:getAutoModeBypass': (_e: unknown, sessionId: string) => agent.getAutoModeBypass(sessionId),
  'agent:setAutoModeBypass': (_e: unknown, sessionId: string, bypass: boolean) =>
    agent.setAutoModeBypass(sessionId, bypass),
  'agent:approveAutoModeCommand': (
    _e: unknown,
    sessionId: string,
    toolCallId: string,
    scope: 'once' | 'session' | 'always',
    teamId?: string,
    ruleDescription?: string,
  ) => agent.approveAutoModeCommand(sessionId, toolCallId, scope, teamId, ruleDescription),
  'agent:denyAutoModeCommand': (
    _e: unknown,
    sessionId: string,
    toolCallId: string,
    teamId?: string,
  ) => agent.denyAutoModeCommand(sessionId, toolCallId, teamId),
} as const
