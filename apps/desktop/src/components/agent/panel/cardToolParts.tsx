import { PermissionGrantCard } from '../PermissionGrantCard'

import { extractProposalIdFromOutput } from './applyEvent'
import { DecisionToolPart } from './ConnectCard'
import { ThreadBadge } from './ThreadBadge'
import { isThreadBadgePart } from './threadBadges'
import { ChartToolPart } from './toolParts'
import { isDecisionCardPart } from './toolRuns'
import { TriggerCard } from './TriggerCard'
import { isTriggerCardPart } from './triggerCards'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'
import type { ReactElement } from 'react'

export type CardContext = {
  teamId: string | undefined
  onOpen: OpenLink | undefined
  now: number
  /** The latest idle reply: decision cards can act. */
  canAct: boolean
  /** Viewer may approve permission-grant proposals. */
  canApprove: boolean
}

/** Tool calls the transcript shows as a card of their own instead of a tool row. */
export function renderCardToolPart(
  part: ToolPart,
  key: string,
  { teamId, onOpen, now, canAct, canApprove }: CardContext,
): ReactElement | null {
  if (isThreadBadgePart(part)) {
    return <ThreadBadge key={key} part={part} teamId={teamId} onOpen={onOpen} />
  }
  if (isTriggerCardPart(part)) {
    return <TriggerCard key={key} part={part} teamId={teamId} onOpen={onOpen} />
  }
  if (part.toolName === 'render_chart') return <ChartToolPart key={key} part={part} now={now} />
  if (isDecisionCardPart(part)) {
    return <DecisionToolPart key={key} part={part} now={now} teamId={teamId} canAct={canAct} />
  }
  if (part.toolName === 'propose_permission_grant') {
    const proposalId = extractProposalIdFromOutput(part.output)

    // No proposalId yet (still streaming) or the tool errored: the generic tool view.
    if (proposalId) {
      return (
        <PermissionGrantCard
          key={key}
          proposalId={proposalId}
          teamId={teamId}
          canApprove={canApprove}
          toolCallId={part.toolCallId}
        />
      )
    }
  }

  return null
}
