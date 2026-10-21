import { memo } from 'react'

import { normalizeRecallFirstOrder, recallLeadCount } from '../../../lib/agentMessagePartOrder'
import { MessageResponse } from '../MessageResponse'
import { isPlanProposalToolName } from '../planReference'

import { liveActivityIndices } from './activity'
import { toolAnchorIds } from './chatTarget'
import { renderCardToolPart } from './cardToolParts'
import { MemoryIngestPartView } from './MemoryIngestPartView'
import { MemoryProvenancePartView } from './MemoryProvenancePartView'
import { AssistantMessageActions } from './messageActions'
import { CollapsedWorkView, PlanBookkeepingPart, ThinkingPartView } from './partChrome'
import { isHiddenMemoryIngestPart } from './parts'
import { renderPartRange, renderSelectedParts } from './renderPartRange'
import { steeringMessage } from './steering'
import { stoppedTurnCalls, withoutNoResponsePlaceholder } from './stoppedTurn'
import { StoppedTurnEnding } from './StoppedTurnEnding'
import { assistantPartKey, lastVisiblePartIndex, turnWorkSeconds } from './streamText'
import { AssistantPlanPart } from './toolParts'
import { ToolPartView } from './ToolPartView'
import { foldedTurnLayout, turnDisplayParts } from './toolRuns'
import { DownloadFilesCard } from './transferCards'
import { turnFoldSplitIndex } from './turnFold'
import { TurnInterruptedPartView } from './TurnInterruptedPartView'
import { TurnLinkChips } from './TurnLinkChips'
import { useAgentLinks } from './useAgentLinks'
import { UserMessage } from './UserMessage'

import type { Message, MessageRating } from './model'
import type { Part, TextPart } from './parts'
import type { RenderPartOptions } from './renderPartRange'
import type { ActivePlanCanAct } from './toolParts'
import type { FileTransferGroup } from '../../../types'

// Historical message identity stays stable across the streaming clock tick.
export const AssistantMessage = memo(
  ({
    message,
    teamId,
    sessionId,
    currentUrl,
    streaming,
    now,
    downloadGroups,
    prevCreatedAt,
    isLatestReply = false,
    onStop,
    onApprovePlan,
    onRejectPlan,
    activePlanCanAct,
    canActOnPlans = false,
    isTeamAdmin = false,
    onOpenNuphosLink,
    onMessageFeedback,
    onRequestFeedbackComment,
    activityHistory = false,
  }: {
    message: Message
    activityHistory?: boolean
    teamId?: string
    sessionId?: string
    currentUrl?: string
    streaming: boolean
    now: number
    /** Files this turn pushed for download (live from the store, see useTransferDownloads). */
    downloadGroups?: FileTransferGroup[]
    /** Preceding message's persisted time — the turn's start, for the fold duration. */
    prevCreatedAt?: number
    /** This is the conversation's last message (no newer user turn) — the
     *  action row stays visible without hover. */
    isLatestReply?: boolean
    /** Viewer is a team administrator — gates approving permission-grant proposals. */
    isTeamAdmin?: boolean
    /** Tab is idle (not streaming, not read-only) — any `proposed` plan card in
     *  the transcript can be approved/rejected, not only the latest. */
    canActOnPlans?: boolean
    onStop?: () => void
    onApprovePlan?: (planId: string) => void
    onRejectPlan?: (planId: string, reason: string, mode: 'revise' | 'delete') => void
    activePlanCanAct?: ActivePlanCanAct | null
    onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
    onMessageFeedback?: (
      sessionId: string,
      messageId: string,
      rating: MessageRating | null,
      comment?: string,
    ) => void
    onRequestFeedbackComment?: (messageId: string) => void
  }) => {
    const renderAgentLink = useAgentLinks(teamId, onOpenNuphosLink)
    const normalizedParts = normalizeRecallFirstOrder(message.parts)
    const orderedParts = withoutNoResponsePlaceholder(normalizedParts)
    const stoppedCalls = streaming ? null : stoppedTurnCalls(orderedParts, message.stoppedByUser)
    const recallLead = recallLeadCount(orderedParts)
    const streamingTailIndex = streaming ? lastVisiblePartIndex(orderedParts) : -1
    const displayParts = turnDisplayParts(orderedParts, streaming)
    const keyCounts: Record<string, number> = {}
    // Copy the answer text, including narration kept in the activity log.
    const copyableText = orderedParts
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n')
      .trim()
    // Fold boundary for a finished turn (see turnFoldSplitIndex).
    const collapseSplit = activityHistory
      ? -1
      : turnFoldSplitIndex(orderedParts, {
          streaming,
          endedWithoutAnswer: message.stoppedByUser === true || orderedParts !== normalizedParts,
        })
    const workSeconds =
      collapseSplit > 0
        ? (turnWorkSeconds(orderedParts) ??
          (typeof message.createdAt === 'number' &&
          typeof prevCreatedAt === 'number' &&
          message.createdAt > prevCreatedAt
            ? Math.round((message.createdAt - prevCreatedAt) / 1000)
            : null))
        : null
    const renderMessagePart = (p: Part, i: number, options?: RenderPartOptions) => {
      const partKey = assistantPartKey(p, i, keyCounts)
      const isStreamingTail = streaming && i === streamingTailIndex && p.type === 'text'

      if (p.type === 'reasoning') {
        return (
          <ThinkingPartView
            key={partKey}
            text={p.text}
            live={streaming && i === orderedParts.length - 1}
          />
        )
      }
      if (p.type === 'text') {
        return (
          <MessageResponse
            key={partKey}
            streaming={isStreamingTail}
            teamId={teamId}
            currentUrl={currentUrl}
            onLinkClick={onOpenNuphosLink}
            renderLink={renderAgentLink}
          >
            {p.text}
          </MessageResponse>
        )
      }
      if (p.type === 'memory-ingest') {
        if (isHiddenMemoryIngestPart(p)) return null

        return <MemoryIngestPartView key={partKey} part={p} teamId={teamId} />
      }
      if (p.type === 'memory-provenance') {
        return <MemoryProvenancePartView key={partKey} part={p} teamId={teamId} />
      }
      if (p.type === 'data-steering') {
        return (
          <UserMessage
            key={partKey}
            message={steeringMessage(p.data)}
            teamId={teamId}
            onOpenNuphosLink={onOpenNuphosLink}
          />
        )
      }
      if (p.type === 'turn-interrupted') {
        return <TurnInterruptedPartView key={partKey} part={p} />
      }
      // `plan_update` / `plan_get` are agent bookkeeping — the inline card
      // reflects their effects via DB state, so we don't render them as tool
      // rows. But while one is in flight, show a shimmer line (like thinking)
      // so the turn doesn't look stalled; it vanishes once the call lands.
      if (p.type === 'tool' && (p.toolName === 'plan_update' || p.toolName === 'plan_get')) {
        return <PlanBookkeepingPart key={partKey} part={p} now={now} />
      }
      // Skill setup output does not render as a tool row.
      if (p.type === 'tool' && p.toolName !== 'skill') {
        const card = renderCardToolPart(p, partKey, {
          teamId,
          onOpen: onOpenNuphosLink,
          now,
          canAct: isLatestReply && !streaming && canActOnPlans,
          canApprove: isTeamAdmin && canActOnPlans,
        })

        if (card) return card
        if (isPlanProposalToolName(p.toolName) || p.toolName === 'plan') {
          return (
            <AssistantPlanPart
              key={partKey}
              part={p}
              now={now}
              teamId={teamId}
              streaming={streaming}
              canActOnPlans={canActOnPlans}
              activePlanCanAct={activePlanCanAct}
              onStop={onStop}
              onApprovePlan={onApprovePlan}
              onRejectPlan={onRejectPlan}
            />
          )
        }

        return (
          <ToolPartView key={partKey} part={p} now={now} initiallyOpen={options?.initiallyOpen} />
        )
      }

      return null
    }
    const renderRange = (from: number, to: number) =>
      renderPartRange(displayParts, from, to, renderMessagePart, now)
    const folded = collapseSplit > recallLead
    const { planIndices, foldHasWork } = folded
      ? foldedTurnLayout(displayParts, recallLead, collapseSplit)
      : { planIndices: [], foldHasWork: false }
    const liftedPlans = new Set(planIndices)
    const renderFoldPart = (p: Part, i: number, options?: RenderPartOptions) =>
      liftedPlans.has(i) ? null : renderMessagePart(p, i, options)
    const liveHistory =
      streaming && !activityHistory ? liveActivityIndices(displayParts) : new Set<number>()
    const liveIndices = displayParts.map((_, index) => index).slice(recallLead)

    const livePast = liveIndices.filter((index) => liveHistory.has(index))
    const liveCurrent = liveIndices.filter((index) => !liveHistory.has(index))

    return (
      <div className="group/message space-y-2">
        {/* Above the fold, always: what the turn already knew when it started. */}
        {renderRange(0, recallLead)}
        {liveHistory.size > 0 ? (
          <>
            <CollapsedWorkView
              seconds={null}
              label="Activity"
              toolCallIds={toolAnchorIds(displayParts.filter((_, index) => liveHistory.has(index)))}
            >
              {() => renderSelectedParts(displayParts, livePast, renderMessagePart, now)}
            </CollapsedWorkView>
            {renderSelectedParts(displayParts, liveCurrent, renderMessagePart, now)}
          </>
        ) : folded ? (
          <>
            {foldHasWork && (
              <CollapsedWorkView
                seconds={workSeconds}
                toolCallIds={toolAnchorIds(displayParts.slice(recallLead, collapseSplit))}
              >
                {() =>
                  renderPartRange(displayParts, recallLead, collapseSplit, renderFoldPart, now)
                }
              </CollapsedWorkView>
            )}
            {renderRange(collapseSplit, orderedParts.length)}
          </>
        ) : (
          renderRange(recallLead, orderedParts.length)
        )}
        {teamId &&
          downloadGroups?.map((group) => (
            <DownloadFilesCard key={group.groupId} group={group} teamId={teamId} />
          ))}
        {/* Mid-turn recall belongs beside what the agent learned. */}
        {orderedParts
          .filter((p) => p.type === 'memory-provenance')
          .map((p) => (
            <MemoryProvenancePartView
              key={`${p.id}:lookedUp`}
              part={p}
              teamId={teamId}
              section="lookedUp"
            />
          ))}
        {planIndices.map((i) => renderMessagePart(displayParts[i], i))}
        {!streaming && (
          <TurnLinkChips parts={orderedParts} teamId={teamId} onOpen={onOpenNuphosLink} />
        )}
        {stoppedCalls !== null && <StoppedTurnEnding calls={stoppedCalls} />}
        {!streaming && copyableText && (
          <AssistantMessageActions
            text={copyableText}
            createdAt={message.createdAt}
            feedback={message.feedback}
            alwaysVisible={isLatestReply}
            onSelectRating={
              sessionId && onMessageFeedback
                ? (rating) => {
                    onMessageFeedback(sessionId, message.id, rating)
                    if (rating === 'down') onRequestFeedbackComment?.(message.id)
                  }
                : undefined
            }
          />
        )}
      </div>
    )
  },
)
