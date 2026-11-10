import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import type { Message } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

/** Only explicit replies name a question. Queueing bypasses steering, while
 * Inbox answers and special turn kinds retain their own-turn routing. */
export function routeSend(
  runtimeState: RuntimeExecution | undefined,
  turnKind: Message['turnKind'] | undefined,
  questionId: string | undefined,
  answering = false,
  mode?: 'queue',
): { steer: boolean; decisionReplyTo?: string } {
  const steer =
    mode !== 'queue' &&
    runtimeAllows(runtimeState, 'steer') &&
    !runtimeAllows(runtimeState, 'reply') &&
    !turnKind &&
    !(answering && questionId)

  return steer || turnKind || !questionId ? { steer } : { steer, decisionReplyTo: questionId }
}
