import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { TeamSession } from './team-openab-runtime'

export function clearCodexAsyncTaskState(session: TeamSession): void {
  session.asyncTaskToolCalls?.clear()
}

export function isTrackedCodexAsyncTaskToolUpdate(
  session: TeamSession,
  update: OpenAbSessionUpdate,
): boolean {
  return (
    update.kind === 'agent' &&
    update.update.kind === 'tool' &&
    [...(session.asyncTaskToolCalls?.values() ?? [])].includes(update.update.toolCallId)
  )
}

export function observeCodexAsyncTask(
  session: TeamSession,
  update: Extract<OpenAbSessionUpdate, { kind: 'async-task' }>,
): void {
  session.asyncTaskToolCalls ??= new Map()
  if (update.phase === 'spawned' && update.toolCallId)
    session.asyncTaskToolCalls.set(update.asyncTaskId, update.toolCallId)
  if (update.state === 'stopped') session.asyncTaskToolCalls.delete(update.asyncTaskId)
}
