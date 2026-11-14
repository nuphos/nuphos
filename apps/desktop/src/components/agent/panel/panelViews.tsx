import clsx from 'clsx'
import { useMemo, useRef } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useStableCallback } from '../../../hooks/useStableCallback'
import { t } from '../../../i18n'
import { track } from '../../../lib/analytics'
import { runtimeIsExecuting, runtimeAllows } from '../../../lib/runtimeExecution'
import { cardAnswers } from '../../../views/inbox/useInbox'
import { toast } from '../../ui/toast'
import { PermissionResumeContext } from '../permissionResumeContext'

import { ChatColumn } from './ChatColumn'
import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { hidingRetracted, sentHistory } from './composerRecall'
import { ConnectCardContext } from './connectCardContext'
import { Conversation } from './Conversation'
import { ConversationPlaceholder } from './ConversationPlaceholder'
import { ConversationReveal } from './ConversationReveal'
import { useConversationRuntimeControl } from './conversationRuntimeControl'
import { DelayedPanelReveal } from './homeAnimation'
import { canEditMessage } from './messageEdit'
import { AuthorizationActionContext } from './parts'
import { canStopTurn, waitingMessages } from './queuedAutoSend'
import { useQueuedShareApproval } from './queuedShareApproval'
import { QueuedStrip } from './QueuedStrip'
import { cardReplyId } from './replyTarget'
import { ReplyTargetChip } from './ReplyTargetChip'
import { serverHasConversation } from './sessionActions'
import { TurnSwitchAgentContext, turnSwitchAgent } from './turnFailureActions'
import { TurnRetryContext, useFailedTurnRetry } from './turnRetryContext'
import { useViewOnlyNotice } from './useViewOnlyNotice'

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
  const { runtimeControl: conversationControl } = useConversationRuntimeControl(c)
  const { runtimeControl, queuedApproval } = useQueuedShareApproval(conversationControl, activeTab)
  const readOnlyNotice = useViewOnlyNotice(c)
  const questions = c.openQuestions ?? c.replyTarget?.questions
  const composerRef = useRef<HTMLDivElement>(null)
  // The composer answers a question where it names one: the "Replying to" chip, or a fixed one.
  const canReply =
    activeTab !== null &&
    !activeTab.readOnly &&
    (c.replyTarget?.sessionId === activeTab.sessionId || c.decisionReplyTo !== undefined)
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
  const shownTab = useMemo(() => activeTab && hidingRetracted(activeTab), [activeTab])
  const turnRetry = useFailedTurnRetry(activeTab, currentUserId, foreignChat, sendInActive)
  // Every message in the transcript receives these handlers. Stable identities
  // keep the messages memoized when this page renders again — opening the dock,
  // a background refresh — instead of rendering the whole transcript each time.
  const fork = useStableCallback(forkConversation)
  // The backend wakes the agent once the approval completes the plan's gate.
  const approvePlan = useStableCallback((planId: string) => {
    if (activeTab?.readOnly) return
    track('agent_plan_approved', { plan_id: planId, surface: 'inline_card' })
    void api.agentUpdatePlan(planId, { status: 'approved' }, teamId).catch((err: unknown) => {
      console.warn('[plan] failed to mark approved', err)
      toast.apiError(t('Could not approve plan'), err, {
        fallback: t('The plan was not approved. Please try again.'),
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
          <div
            className={clsx(
              'relative grid min-h-0 flex-1 grid-cols-1',
              c.hideTranscript ? 'grid-rows-[0_auto]' : 'grid-rows-[1fr_auto]',
            )}
          >
            {/* Keep the transcript above the composer as its height changes. */}
            <div
              className={clsx(
                'col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden',
                c.hideTranscript && 'hidden',
              )}
            >
              <ConnectCardContext.Provider
                value={{
                  credentials: activeTab.readOnly
                    ? undefined
                    : visibleConversationCredentialSelector,
                  send: (text, card) =>
                    sendInActive(text, [], undefined, card && cardReplyId(card, questions)),
                  answer: canReply
                    ? cardAnswers(teamId, activeTab.sessionId, questions)
                    : undefined,
                  // Only the owner provides a secret; it lands on their runtime.
                  saveSecret:
                    activeTab.readOnly || activeTab.foreign
                      ? undefined
                      : async (name, value) =>
                          (await api.agentSaveSecret(activeTab.sessionId, name, value, teamId))
                            .path,
                  openQuestions: c.openQuestions,
                }}
              >
                <TurnSwitchAgentContext.Provider value={turnSwitchAgent(activeTab)}>
                  <TurnRetryContext.Provider value={turnRetry}>
                    <Conversation
                      tab={shownTab ?? activeTab}
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
                  </TurnRetryContext.Provider>
                </TurnSwitchAgentContext.Provider>
              </ConnectCardContext.Provider>
            </div>
            <div ref={composerRef} className="col-start-1 row-start-2 z-10">
              <ChatColumn sidebar={isSidebarMode}>
                {waitingMessages(activeTab).length > 0 && (
                  <QueuedStrip
                    items={waitingMessages(activeTab)}
                    approval={queuedApproval}
                    canSteer={runtimeAllows(activeTab.runtimeState, 'steer')}
                    onRemove={(queuedId) => void removeQueued(activeTab.id, queuedId)}
                    onSteer={(queuedId) => void steerQueued(activeTab.id, queuedId)}
                  />
                )}
                {activeTab.messages.length === 0 ? (
                  <DelayedPanelReveal>
                    <Composer
                      onSend={(text, filePaths, mentions, { mode } = {}) =>
                        sendInActive(text, filePaths, undefined, c.decisionReplyTo, mentions, mode)
                      }
                      onStop={stopActive}
                      autoFocus={focusComposerOnOpen}
                      runtimeState={activeTab.runtimeState}
                      executing={runtimeIsExecuting(activeTab.runtimeState)}
                      readOnly={activeTab.readOnly}
                      readOnlyNotice={readOnlyNotice}
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
                      draftKey={composerDraftKey(teamId, c.composerDraftId ?? activeTab.sessionId)}
                      recall={{ retract: retractLatest, history: [] }}
                      mentionScope={teamId ? { teamId, sessionId: inviteSessionId } : undefined}
                    />
                  </DelayedPanelReveal>
                ) : (
                  <>
                    {c.replyTarget?.sessionId === activeTab.sessionId && !activeTab.readOnly && (
                      <ReplyTargetChip target={c.replyTarget} />
                    )}
                    <Composer
                      onSend={(text, filePaths, mentions, { mode } = {}) =>
                        sendInActive(text, filePaths, undefined, c.decisionReplyTo, mentions, mode)
                      }
                      onStop={stopActive}
                      promptSuggestion={
                        activeTab.streaming || runtimeIsExecuting(activeTab.runtimeState)
                          ? null
                          : activeTab.promptSuggestion
                      }
                      autoFocus={focusComposerOnOpen}
                      runtimeState={activeTab.runtimeState}
                      canStop={canStopTurn(activeTab)}
                      readOnly={activeTab.readOnly}
                      readOnlyNotice={readOnlyNotice}
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
                      draftKey={composerDraftKey(teamId, c.composerDraftId ?? activeTab.sessionId)}
                      recall={{ retract: retractLatest, history }}
                      mentionScope={teamId ? { teamId, sessionId: inviteSessionId } : undefined}
                    />
                  </>
                )}
              </ChatColumn>
            </div>
          </div>
        </AuthorizationActionContext.Provider>
      </PermissionResumeContext.Provider>
    </ConversationReveal>
  ) : (
    <ConversationPlaceholder
      unavailable={c.openingConversation?.unavailable === true}
      onNewChat={c.startNewChat}
    />
  )
}
