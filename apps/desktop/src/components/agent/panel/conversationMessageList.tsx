import { AlarmClock, Loader2 } from 'lucide-react'
import { Fragment } from 'react'

import { runtimeAllows, runtimeIsExecuting } from '../../../lib/runtimeExecution'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import { AgentSetupRequiredCard } from './AgentSetupRequiredCard'
import { AssistantMessage } from './AssistantMessage'
import { SlackThreadBanner } from './conversationBanners'
import { AgentHomeAnimation } from './homeAnimation'
import { ElapsedSeconds, LoadingText } from './partChrome'
import { ShellsPanel } from './ShellsPanel'
import { DEFERRED_MESSAGE_STYLE } from './status'
import { MovingSessionLine, TimelineEventLine } from './TimelineEventLine'
import { placeTimelineEvents } from './timelineEvents'
import { UserMessage } from './UserMessage'
import { useTransferDownloads } from './useTransferDownloads'

import type { ConversationProps } from './conversationProps'
import type { Message, Tab } from './model'

export function ConversationMessageList({
  tab,
  teamId,
  currentUrl,
  lastMsg,
  now,
  statusLabel,
  sendingFeedback = false,
  statusElapsed,
  hasEarlier,
  captureEarlierAnchor,
  onLoadEarlier,
  onStop,
  onApprovePlan,
  onRejectPlan,
  activePlanCanAct,
  onOpenNuphosLink,
  onOpenAgentSettings,
  isTeamAdmin,
  onMessageFeedback,
  onRequestFeedbackComment,
}: Pick<
  ConversationProps,
  | 'teamId'
  | 'currentUrl'
  | 'onLoadEarlier'
  | 'onStop'
  | 'onApprovePlan'
  | 'onRejectPlan'
  | 'activePlanCanAct'
  | 'onOpenNuphosLink'
  | 'onOpenAgentSettings'
  | 'onMessageFeedback'
> & {
  tab: Tab
  lastMsg: Message | undefined
  now: number
  sendingFeedback?: boolean
  statusLabel: string | null
  statusElapsed: number | null
  hasEarlier: boolean
  captureEarlierAnchor: () => void
  isTeamAdmin: boolean
  onRequestFeedbackComment: (messageId: string) => void
}) {
  useReportVisibleError(tab.error, 'agent_conversation_error')
  const downloadsByMessage = useTransferDownloads(tab, teamId)
  const timeline = placeTimelineEvents(tab.messages, tab.timelineEvents, hasEarlier)
  // Events newer than the moment this session was opened animate in; the ones
  // it opened with do not.
  const openedAt = tab.openedAt ?? 0

  return (
    // Match the composer's column and inner padding so messages stay inside its edges.
    <div className="mx-auto w-full max-w-[760px] space-y-4 px-3">
      {hasEarlier && (
        <div
          // Read by SessionFindBar: part of the conversation is not in the DOM.
          data-earlier-messages
          className="flex items-center justify-center gap-2 py-1 text-[11.5px] text-tertiary"
        >
          {tab.loadingEarlier ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading earlier messages…
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                captureEarlierAnchor()
                onLoadEarlier?.()
              }}
              className="hover:text-main transition-colors"
            >
              Load earlier messages
            </button>
          )}
        </div>
      )}
      {tab.slackThread && <SlackThreadBanner thread={tab.slackThread} />}
      {tab.messages.length === 0 ? (
        <div className="flex min-h-[30vh] items-end">
          <AgentHomeAnimation />
        </div>
      ) : (
        tab.messages.map((m, mi) => {
          const isLast = m.id === lastMsg?.id
          // Turn start for the "Worked for Xs" fold: the preceding user
          // message's persisted time.
          const prevCreatedAt = tab.messages[mi - 1]?.createdAt
          // Only the last message can be streaming, and only a running tool
          // reads `now` — so historical messages get a frozen `now`, keeping
          // their memoized render stable across the 1s streaming tick.
          const isStreamingMessage = runtimeIsExecuting(tab.runtimeState) && isLast
          // Defer paint on everything but the last message (see
          // DEFERRED_MESSAGE_STYLE) so a growing/streaming tail stays live.
          const wrapperStyle = isLast ? undefined : DEFERRED_MESSAGE_STYLE

          const message =
            m.role === 'user' ? (
              <div
                key={m.id}
                data-message-id={m.id}
                className="transition-shadow"
                style={wrapperStyle}
              >
                <UserMessage
                  message={m}
                  teamId={teamId}
                  onApprovePlan={onApprovePlan}
                  onRejectPlan={onRejectPlan}
                  canActOnPlans={
                    (runtimeAllows(tab.runtimeState, 'send') ||
                      runtimeAllows(tab.runtimeState, 'reply')) &&
                    !tab.readOnly
                  }
                  onOpenNuphosLink={onOpenNuphosLink}
                />
              </div>
            ) : (
              <div
                key={m.id}
                data-message-id={m.id}
                className="transition-shadow"
                style={wrapperStyle}
              >
                {m.turnOrigin === 'autonomous' && (
                  <div className="mb-4 flex items-center gap-2 text-[11.5px] text-tertiary">
                    <AlarmClock className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">Resumed automatically</span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                )}
                <AssistantMessage
                  message={m}
                  teamId={teamId}
                  sessionId={tab.sessionId}
                  currentUrl={currentUrl}
                  streaming={isStreamingMessage}
                  now={isStreamingMessage ? now : 0}
                  downloadGroups={downloadsByMessage.get(m.id)}
                  prevCreatedAt={m.turnOrigin === 'autonomous' ? undefined : prevCreatedAt}
                  isLatestReply={isLast}
                  onStop={onStop}
                  onApprovePlan={onApprovePlan}
                  onRejectPlan={onRejectPlan}
                  activePlanCanAct={activePlanCanAct ?? null}
                  canActOnPlans={
                    (runtimeAllows(tab.runtimeState, 'send') ||
                      runtimeAllows(tab.runtimeState, 'reply')) &&
                    !tab.readOnly
                  }
                  isTeamAdmin={isTeamAdmin}
                  onOpenNuphosLink={onOpenNuphosLink}
                  // Feedback is owner-only (backend 403s otherwise); read-only
                  // team views get copy + time but no vote buttons.
                  onMessageFeedback={tab.readOnly || tab.foreign ? undefined : onMessageFeedback}
                  onRequestFeedbackComment={onRequestFeedbackComment}
                />
              </div>
            )

          return (
            <Fragment key={m.id}>
              {timeline.before.get(m.id)?.map((event) => (
                <TimelineEventLine
                  key={`${event.at}-${event.text}`}
                  event={event}
                  reveal={Date.parse(event.at) > openedAt}
                />
              ))}
              {message}
            </Fragment>
          )
        })
      )}
      {timeline.trailing.map((event) => (
        <TimelineEventLine
          key={`${event.at}-${event.text}`}
          event={event}
          reveal={Date.parse(event.at) > openedAt}
        />
      ))}
      {tab.movingTo && <MovingSessionLine label={tab.movingTo} />}
      <ShellsPanel snapshot={tab.runtimeState} />
      {statusLabel && (
        <div className="text-[13.5px] flex items-center gap-2">
          {sendingFeedback ? (
            <span role="status" className="text-tertiary">
              {statusLabel}
            </span>
          ) : runtimeIsExecuting(tab.runtimeState) ? (
            <LoadingText>{statusLabel}</LoadingText>
          ) : (
            <span role="status">{statusLabel}</span>
          )}
          {statusElapsed !== null && (
            <span className="font-mono text-[12px] text-tertiary tabular-nums">
              <ElapsedSeconds seconds={statusElapsed} />
            </span>
          )}
        </div>
      )}
      {tab.agentSetupRequired && (
        <AgentSetupRequiredCard
          runtimeId={tab.runtimeId}
          message={tab.agentSetupRequired.message}
          reason={tab.agentSetupRequired.reason}
          isTeamAdmin={isTeamAdmin}
          onOpenAgentSettings={onOpenAgentSettings}
        />
      )}
      {tab.error && (
        <div className="text-[13px] text-error bg-error/10 border border-error/20 rounded-md px-3 py-2">
          {tab.error}
        </div>
      )}
      <div className="h-px" />
    </div>
  )
}
