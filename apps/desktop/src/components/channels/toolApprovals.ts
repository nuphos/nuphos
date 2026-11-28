import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

/** A tool call the Bot's turn waits on, for its owner to allow or reject. */
export type PendingToolApproval = {
  waitId: string
  toolCallId: string
  title: string
  /** When it was asked, epoch milliseconds. */
  at: number
}

/**
 * The tool approvals a Bot's turn waits on, as its runtime reports them, the
 * oldest first. Each names the tool call it holds, whose title says what it runs.
 */
export function pendingToolApprovals(
  runtimeState: RuntimeExecution | undefined,
): PendingToolApproval[] {
  const tools = runtimeState?.tools ?? []

  return (runtimeState?.requests ?? [])
    .filter((request) => request.kind === 'agent-permission' && request.ref)
    .map((request) => ({
      waitId: request.waitId,
      toolCallId: request.ref!,
      title: tools.find((tool) => tool.id === request.ref)?.title?.trim() ?? '',
      at: request.createdAt,
    }))
    .sort((a, b) => a.at - b.at)
}
