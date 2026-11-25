import { findPreviewWaitByRef, resolvePreviewDecision } from './decision-waiter'

export type ToolApprovalDecision = 'allow' | 'reject'

type Deps = {
  findWait: typeof findPreviewWaitByRef
  resolve: typeof resolvePreviewDecision
}

const defaultDeps: Deps = { findWait: findPreviewWaitByRef, resolve: resolvePreviewDecision }

/**
 * Answers a tool approval a conversation's turn is waiting on, from outside its
 * panel, such as the owner's Bot chat. Only the person the request waits for may
 * answer it, the same rule as the Slack and Discord buttons.
 */
export async function decideToolApproval(
  args: {
    userId: string
    sessionId: string
    toolCallId: string
    decision: ToolApprovalDecision
  },
  deps: Deps = defaultDeps,
): Promise<'decided' | 'expired' | 'forbidden'> {
  const wait = await deps.findWait('agent-permission', args.toolCallId)

  if (!wait || wait.sessionId !== args.sessionId) return 'expired'
  if (wait.userId !== args.userId) return 'forbidden'
  const decided = await deps.resolve({
    userId: wait.userId,
    sessionId: wait.sessionId,
    waitId: wait.waitId,
    payload: { decision: args.decision === 'allow' ? 'approved' : 'rejected' },
  })

  return decided ? 'decided' : 'expired'
}
