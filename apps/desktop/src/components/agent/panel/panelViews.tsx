import { Loader2 } from 'lucide-react'

import { api } from '../../../api'
import { track } from '../../../lib/analytics'
import { runtimeIsExecuting, runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'
import { PermissionResumeContext } from '../permissionResumeContext'

import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { Conversation } from './Conversation'
import { ConversationReveal } from './ConversationReveal'
import { useConversationRuntimeControl } from './conversationRuntimeControl'
import { DelayedPanelReveal } from './homeAnimation'
import { NewConversationModelSelector } from './NewConversationModelSelector'
import { AuthorizationActionContext } from './parts'
import { QueuedStrip } from './QueuedStrip'

import type { PanelViewCtx } from './ctx'

// The home page lives next door; re-exported so call sites keep one import.
export { PanelHomePage } from './panelHomeView'

export function PanelConversationPage({ c }: { c: PanelViewCtx }) {
  const {
    activePlanCanAct,
    activeTab,
    authorizationContextValue,
    autoModeAvailable,
    bypassBySession,
    conversationDropRef,
    dockCurrentSession,
    onDockToSidebar,
    gated,
    handleMessageFeedback,
    handleRejectPlan,
    isSidebarMode,
    isTeamAdmin,
    loadEarlierMessages,
    onOpenNuphosLink,
    onOpenAgentSettings,
    onPromptConsumed,
    pendingPromptReady,
    removeQueued,
    steerQueued,
    resumePermissionTurn,
    selectBypassMode,
    sendInActive,
    stopActive,
    switchingConversation,
    teamId,
    url,
    variant,
    visibleConversationCredentialSelector,
  } = c
  const { runtimeControl } = useConversationRuntimeControl(c)
  const modelSession =
    activeTab?.sessionId && !activeTab.foreign && teamId
      ? {
          sessionId: activeTab.sessionId,
          teamId,
          initialModelName:
            activeTab.initialModel?.runtimeId === activeTab.runtimeId
              ? activeTab.initialModel?.name
              : undefined,
        }
      : undefined
  // Until the runtime session exists, the first message applies the agent's
  // defaults (also right after a move), so show and edit those.
  const runtime = c.runtimeInstances.find((instance) => instance.id === activeTab?.runtimeId)
  const defaultModelControl =
    modelSession && runtime && (runtime.kind === 'local' || isTeamAdmin) ? (
      <NewConversationModelSelector teamId={teamId} runtime={runtime} isTeamAdmin={isTeamAdmin} />
    ) : undefined
  // Only the owner decides who has access, so only they are offered an invite
  // for the teammates they mention.
  const inviteSessionId = activeTab?.foreign ? undefined : activeTab?.sessionId
  const bypassControl =
    autoModeAvailable && activeTab?.sessionId && !activeTab.readOnly && !activeTab.foreign && !gated
      ? { active: bypassBySession[activeTab.sessionId] ?? false, onSelect: selectBypassMode }
      : undefined

  return activeTab && !switchingConversation ? (
    <ConversationReveal sessionId={activeTab.sessionId}>
      <PermissionResumeContext.Provider value={resumePermissionTurn}>
        <AuthorizationActionContext.Provider value={authorizationContextValue}>
          <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[1fr_auto]">
            {/* Keep the transcript above the composer as its height changes. */}
            <div className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden">
              <Conversation
                tab={activeTab}
                visible={c.visible && c.showingConversationPage}
                teamId={teamId}
                isTeamAdmin={isTeamAdmin}
                currentUrl={url}
                sidebar={isSidebarMode}
                onLoadEarlier={() => void loadEarlierMessages(activeTab.id)}
                onMessageFeedback={handleMessageFeedback}
                // Only show docking where a sidebar host exists.
                onDockToSidebar={
                  variant === 'page' && onDockToSidebar ? dockCurrentSession : undefined
                }
                onStop={stopActive}
                onApprovePlan={(planId) => {
                  if (activeTab.readOnly) return
                  track('agent_plan_approved', { plan_id: planId, surface: 'inline_card' })
                  // Persist approval; the usePlan poll reflects the new status.
                  void api
                    .agentUpdatePlan(planId, { status: 'approved' }, teamId)
                    .then((updated) => {
                      // A vote may leave the plan proposed under a team quorum. Only
                      // the request that completes the gate resumes Agent execution.
                      // Slack-bound conversations execute through the backend's plan
                      // resume in the bound thread — sending a proceed turn here too
                      // would race it and could run the plan twice.
                      if (updated.status === 'approved' && !activeTab.slackThread) {
                        void sendInActive(
                          `Approved plan #${planId} — please proceed with plan #${planId}.`,
                          [],
                          'plan-approval',
                        )
                      }
                    })
                    .catch((err: unknown) => {
                      console.warn('[plan] failed to mark approved', err)
                      toast.apiError('Could not approve plan', err, {
                        fallback: 'The plan was not approved. Please try again.',
                      })
                    })
                }}
                onRejectPlan={(planId, reason, mode) => {
                  void handleRejectPlan(planId, reason, mode, 'the plan')
                }}
                activePlanCanAct={activePlanCanAct}
                onOpenNuphosLink={onOpenNuphosLink}
                onOpenAgentSettings={onOpenAgentSettings}
              />
            </div>
            <div className="col-start-1 row-start-2 z-10">
              {activeTab.queued && activeTab.queued.length > 0 && (
                <QueuedStrip
                  items={activeTab.queued}
                  canSend={runtimeAllows(activeTab.runtimeState, 'send')}
                  canSteer={runtimeAllows(activeTab.runtimeState, 'steer')}
                  onRemove={(queuedId) => removeQueued(activeTab.id, queuedId)}
                  onSteer={(queuedId) => void steerQueued(activeTab.id, queuedId)}
                  sidebar={isSidebarMode}
                />
              )}
              {activeTab.messages.length === 0 ? (
                <DelayedPanelReveal>
                  <Composer
                    onSend={(text, filePaths) => void sendInActive(text, filePaths)}
                    onStop={stopActive}
                    streaming={false}
                    runtimeState={activeTab.runtimeState ?? { state: 'unknown' }}
                    executing={runtimeIsExecuting(activeTab.runtimeState)}
                    readOnly={activeTab.readOnly}
                    activitySource={activeTab.activitySource}
                    slackThread={activeTab.slackThread}
                    credentialSelector={visibleConversationCredentialSelector}
                    runtimeControl={runtimeControl}
                    modelSession={modelSession}
                    newConversationModelControl={defaultModelControl}
                    bypassControl={bypassControl}
                    pendingSeed={pendingPromptReady}
                    onSeedConsumed={onPromptConsumed}
                    sidebar={isSidebarMode}
                    dropRegisterRef={conversationDropRef}
                    draftKey={composerDraftKey(teamId, activeTab.sessionId)}
                    mentionScope={teamId ? { teamId, sessionId: inviteSessionId } : undefined}
                  />
                </DelayedPanelReveal>
              ) : (
                <Composer
                  onSend={(text, filePaths) => void sendInActive(text, filePaths)}
                  onStop={stopActive}
                  streaming={false}
                  promptSuggestion={
                    activeTab.streaming || runtimeIsExecuting(activeTab.runtimeState)
                      ? null
                      : activeTab.promptSuggestion
                  }
                  autoFocus
                  runtimeState={activeTab.runtimeState ?? { state: 'unknown' }}
                  executing={runtimeIsExecuting(activeTab.runtimeState)}
                  readOnly={activeTab.readOnly}
                  activitySource={activeTab.activitySource}
                  slackThread={activeTab.slackThread}
                  credentialSelector={visibleConversationCredentialSelector}
                  runtimeControl={runtimeControl}
                  modelSession={modelSession}
                  newConversationModelControl={defaultModelControl}
                  bypassControl={bypassControl}
                  pendingSeed={pendingPromptReady}
                  onSeedConsumed={onPromptConsumed}
                  sidebar={isSidebarMode}
                  dropRegisterRef={conversationDropRef}
                  draftKey={composerDraftKey(teamId, activeTab.sessionId)}
                  mentionScope={teamId ? { teamId, sessionId: inviteSessionId } : undefined}
                />
              )}
            </div>
          </div>
        </AuthorizationActionContext.Provider>
      </PermissionResumeContext.Provider>
    </ConversationReveal>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
      <Loader2
        className="h-4 w-4 animate-spin text-tertiary/70"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span className="sr-only">Opening chat</span>
    </div>
  )
}
