import { BotChatToolApproval } from './BotChatToolApproval'
import { pendingToolApprovals } from './toolApprovals'

import type { TimelineRow } from './ChannelMessages'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

/**
 * The tool calls the Bot's turn waits on, as lines in its chat at the time each
 * was asked. Only the owner is asked to allow them, here as in the Bot's panel.
 */
export function toolApprovalRows(
  teamId: string,
  botId: string | undefined,
  botOwned: boolean,
  runtimeState: RuntimeExecution | undefined,
): TimelineRow[] {
  if (!botId || !botOwned) return []

  return pendingToolApprovals(runtimeState).map((approval) => ({
    at: approval.at,
    key: `tool-approval-${approval.waitId}`,
    node: (
      // Inset past the faces on both sides, so the card lines up with the bubbles.
      <div className="px-[2.375rem]" data-open-question>
        <BotChatToolApproval teamId={teamId} botId={botId} approval={approval} />
      </div>
    ),
  }))
}
