import { memo } from 'react'

import { normalizeRecallFirstOrder, recallLeadCount } from '../../../lib/agentMessagePartOrder'
import { MessageResponse } from '../MessageResponse'
import { PermissionGrantCard } from '../PermissionGrantCard'
import { isPlanProposalToolName } from '../planReference'

import { extractProposalIdFromOutput } from './applyEvent'
import { ConnectToolPart } from './ConnectCard'
import { MemoryIngestPartView } from './MemoryIngestPartView'
import { MemoryProvenancePartView } from './MemoryProvenancePartView'
import { AssistantMessageActions } from './messageActions'
import { CollapsedWorkView, PlanBookkeepingPart, ThinkingPartView } from './partChrome'
import { isHiddenMemoryIngestPart } from './parts'
import { renderPartRange } from './renderPartRange'
import { steeringMessage } from './steering'
import { stoppedTurnCalls, withoutNoResponsePlaceholder } from './stoppedTurn'
import { StoppedTurnEnding } from './StoppedTurnEnding'
import { assistantPartKey, lastVisiblePartIndex, turnWorkSeconds } from './streamText'
import { AssistantPlanPart, ChartToolPart } from './toolParts'
import { ToolPartView } from './ToolPartView'
import { foldedTurnLayout, isConnectCardPart, turnDisplayParts } from './toolRuns'
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

// Memoized so a long transcript doesn't re-render every message on each parent
// update (notably the 1s `now` tick during streaming). Historical messages keep
// their object identity across updates, so memo skips them; only the streaming
// message — which gets a live `now` and a changing `message` — actually redraws.
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
  }: {
    message: Message
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
    // The response text the copy button writes to the clipboard — the rendered
    // markdown answer only, not tool calls / reasoning.
    const copyableText = orderedParts
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n')
      .trim()
    // Fold boundary for a finished turn (see turnFoldSplitIndex).
    const collapseSplit = turnFoldSplitIndex(orderedParts, {
      streaming,
      endedWithoutAnswer: message.stoppedByUser === true || orderedParts !== normalizedParts,
    })
    // Duration: live-completed turns carry client-stamped tool timestamps;
    // reloaded transcripts fall back to persisted message times (prev user
    // message → this assistant message ≈ the whole turn).
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
      // `skill` tool calls are setup noise (the input is just a skill name,
      // the output is the entire SKILL.md). Don't render them.
      if (p.type === 'tool' && p.toolName !== 'skill') {
        if (p.toolName === 'render_chart') {
          return <ChartToolPart key={partKey} part={p} now={now} />
        }
        if (isConnectCardPart(p)) {
          return (
            <ConnectToolPart
              key={partKey}
              part={p}
              now={now}
              teamId={teamId}
              canAct={isLatestReply && !streaming && canActOnPlans}
            />
          )
        }
        if (p.toolName === 'propose_permission_grant') {
          const proposalId = extractProposalIdFromOutput(p.output)

          if (proposalId) {
            return (
              <PermissionGrantCard
                key={partKey}
                proposalId={proposalId}
                teamId={teamId}
                canApprove={isTeamAdmin && canActOnPlans}
                toolCallId={p.toolCallId}
              />
            )
          }
          // No proposalId yet (still streaming) or the tool errored — fall
          // through to the generic tool view.
        }
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

    return (
      <div className="group/message space-y-2">
        {/* Above the fold, always: what the turn already knew when it started. */}
        {renderRange(0, recallLead)}
        {folded ? (
          <>
            {foldHasWork && (
              <CollapsedWorkView seconds={workSeconds}>
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
        {/* The same provenance part, rendered again for its other moment: what
            the agent looked up mid-turn belongs down here with what the turn
            learned, not up top with what it already remembered. Renders
            nothing when the agent looked nothing up. */}
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
