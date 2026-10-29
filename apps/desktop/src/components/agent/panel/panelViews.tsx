import { Loader2 } from 'lucide-react'
import { useMemo } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useStableCallback } from '../../../hooks/useStableCallback'
import { track } from '../../../lib/analytics'
import { runtimeIsExecuting, runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'
import { PermissionResumeContext } from '../permissionResumeContext'

import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { sentHistory } from './composerRecall'
import { ConnectCardContext } from './connectCardContext'
import { Conversation } from './Conversation'
import { ConversationReveal } from './ConversationReveal'
import { useConversationRuntimeControl } from './conversationRuntimeControl'
import { DelayedPanelReveal } from './homeAnimation'
import { canEditMessage } from './messageEdit'
import { AuthorizationActionContext } from './parts'
import { waitingMessages } from './queuedAutoSend'
import { QueuedStrip } from './QueuedStrip'
import { serverHasConversation } from './sessionActions'

import type { PanelViewCtx } from './ctx'
import type { Message } from './model'

// The home page lives next door; re-exported so call sites keep one import.
export { PanelHomePage } from './panelHomeView'

export function PanelConversationPage({ c }: { c: PanelViewCtx }) {
  const {
    activePlanCanAct,
    activeTab,
    authorizationContextValue,
    bypassBySession,
    conversationDropRef,
    dockCurrentSession,
    focusComposerOnOpen,
    forkConversation,
    onDockToSidebar,
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
    retractLatest,
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
  // The fork needs the chat stored on the server; each message is then gated on its author.
  const editableSessionId =
    activeTab && !activeTab.readOnly && !activeTab.unsaved ? activeTab.sessionId : undefined
  const foreignChat = Boolean(activeTab?.foreign)
  const currentUserId = useCurrentUser()?.id
  const activeMessages = activeTab?.messages
  const history = useMemo(
    () => sentHistory(activeMessages ?? [], currentUserId, foreignChat),
    [activeMessages, currentUserId, foreignChat],
  )
  // Every message in the transcript receives these handlers. Stable identities
  // keep the messages memoized when this page renders again — opening the dock,
  // a background refresh — instead of rendering the whole transcript each time.
  const fork = useStableCallback(forkConversation)
  const approvePlan = useStableCallback((planId: string) => {
    if (activeTab?.readOnly) return
    track('agent_plan_approved', {
      plan_id: planId,
      surface: 'inline_card',
    })
    // Persist approval; the usePlan poll reflects the new status.
    void api
      .agentUpdatePlan(planId, { status: 'approved' }, teamId)
      .then((updated) => {
        // A vote may leave the plan proposed under a team quorum. Only
        // the request that completes the gate resumes Agent execution.
        // Slack-bound conversations execute through the backend's plan
        // resume in the bound thread — sending a proceed turn here too
        // would race it and could run the plan twice.
        if (updated.status === 'approved' && !activeTab?.slackThread) {
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
  })
  const rejectPlan = useStableCallback(
    (planId: string, reason: string, mode: 'revise' | 'delete') => {
      void handleRejectPlan(planId, reason, mode, 'the plan')
    },
  )
  const editMessage = useMemo(
    () =>
      editableSessionId
        ? {
            allowed: (message: Message) => canEditMessage(message, currentUserId, foreignChat),
            edit: (messageId: string, text: string) =>
              void fork(editableSessionId, { messageId, text }),
          }
        : undefined,
    [currentUserId, editableSessionId, foreignChat, fork],
  )
  const modelSession =
    activeTab?.sessionId && !activeTab.foreign && teamId && serverHasConversation(activeTab)
      ? {
          sessionId: activeTab.sessionId,
          teamId,
          runtimeId: activeTab.runtimeId,
        }
      : undefined
  // Only the owner decides who has access, so only they are offered an invite
  // for the teammates they mention.
  const inviteSessionId = activeTab?.foreign ? undefined : activeTab?.sessionId
  const bypassControl =
    activeTab?.sessionId && !activeTab.readOnly && (!activeTab.foreign || activeTab.canManage)
      ? {
          active: bypassBySession[activeTab.sessionId] ?? false,
          onSelect: selectBypassMode,
        }
      : undefined

  return activeTab && !switchingConversation ? (
    <ConversationReveal sessionId={activeTab.sessionId}>
      <PermissionResumeContext.Provider value={resumePermissionTurn}>
        <AuthorizationActionContext.Provider value={authorizationContextValue}>
          <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[1fr_auto]">
            {/* Keep the transcript above the composer as its height changes. */}
            <div className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden">
              <ConnectCardContext.Provider
                value={{
                  credentials: activeTab.readOnly
                    ? undefined
                    : visibleConversationCredentialSelector,
                  send: (text) => void sendInActive(text),
                  // Only the owner provides a secret; it lands on their runtime.
                  saveSecret:
                    activeTab.readOnly || activeTab.foreign
                      ? undefined
                      : async (name, value) =>
                          (await api.agentSaveSecret(activeTab.sessionId, name, value, teamId))
                            .path,
                }}
              >
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
                  onApprovePlan={approvePlan}
                  onRejectPlan={rejectPlan}
                  activePlanCanAct={activePlanCanAct}
                  onOpenNuphosLink={onOpenNuphosLink}
                  onOpenAgentSettings={onOpenAgentSettings}
                  onEditMessage={editMessage}
                />
              </ConnectCardContext.Provider>
            </div>
            <div className="col-start-1 row-start-2 z-10">
              {waitingMessages(activeTab).length > 0 && (
                <QueuedStrip
                  items={waitingMessages(activeTab)}
                  canSteer={runtimeAllows(activeTab.runtimeState, 'steer')}
                  onRemove={(queuedId) => void removeQueued(activeTab.id, queuedId)}
                  onSteer={(queuedId) => void steerQueued(activeTab.id, queuedId)}
                  sidebar={isSidebarMode}
                />
              )}
              {activeTab.messages.length === 0 ? (
                <DelayedPanelReveal>
                  <Composer
                    onSend={(text, filePaths) => sendInActive(text, filePaths)}
                    onStop={stopActive}
                    autoFocus={focusComposerOnOpen}
                    runtimeState={activeTab.runtimeState ?? { state: 'unknown' }}
                    executing={runtimeIsExecuting(activeTab.runtimeState)}
                    readOnly={activeTab.readOnly}
                    activitySource={activeTab.activitySource}
                    slackThread={activeTab.slackThread}
                    credentialSelector={visibleConversationCredentialSelector}
                    runtimeControl={runtimeControl}
                    modelSession={modelSession}
                    bypassControl={bypassControl}
                    pendingSeed={pendingPromptReady}
                    onSeedConsumed={onPromptConsumed}
                    sidebar={isSidebarMode}
                    dropRegisterRef={conversationDropRef}
                    draftKey={composerDraftKey(teamId, activeTab.sessionId)}
                    recall={{ retract: retractLatest, history: [] }}
                    mentionScope={teamId ? { teamId, sessionId: inviteSessionId } : undefined}
                  />
                </DelayedPanelReveal>
              ) : (
                <Composer
                  onSend={(text, filePaths) => sendInActive(text, filePaths)}
                  onStop={stopActive}
                  promptSuggestion={
                    activeTab.streaming || runtimeIsExecuting(activeTab.runtimeState)
                      ? null
                      : activeTab.promptSuggestion
                  }
                  autoFocus={focusComposerOnOpen}
                  runtimeState={activeTab.runtimeState ?? { state: 'unknown' }}
                  executing={runtimeIsExecuting(activeTab.runtimeState)}
                  readOnly={activeTab.readOnly}
                  activitySource={activeTab.activitySource}
                  slackThread={activeTab.slackThread}
                  credentialSelector={visibleConversationCredentialSelector}
                  runtimeControl={runtimeControl}
                  modelSession={modelSession}
                  bypassControl={bypassControl}
                  pendingSeed={pendingPromptReady}
                  onSeedConsumed={onPromptConsumed}
                  sidebar={isSidebarMode}
                  dropRegisterRef={conversationDropRef}
                  draftKey={composerDraftKey(teamId, activeTab.sessionId)}
                  recall={{ retract: retractLatest, history }}
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
      <span className="sr-only">Opening agent</span>
    </div>
  )
}
