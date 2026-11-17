import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import type { Message } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

/** Only a card's answer names a question; it waits for its own turn rather than
 * steering, as do queued sends and special turn kinds. */
export function routeSend(
  runtimeState: RuntimeExecution | undefined,
  turnKind: Message['turnKind'] | undefined,
  questionId: string | undefined,
  mode?: 'queue',
): { steer: boolean; decisionReplyTo?: string } {
  const steer =
    mode !== 'queue' &&
    runtimeAllows(runtimeState, 'steer') &&
    !runtimeAllows(runtimeState, 'reply') &&
    !turnKind &&
    !questionId

  return steer || turnKind || !questionId ? { steer } : { steer, decisionReplyTo: questionId }
}
