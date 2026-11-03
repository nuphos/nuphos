import { t } from '../../../i18n/index.ts'
import { usable } from '../../../lib/agentName.ts'
import { isLocalAgentRuntime } from '../../../lib/localAgentSharing.ts'

import type { Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

/** Someone's own computer takes only its owner's turns (#667): say so before a
 *  send fails, and offer the teammate a chat of their own there when they may use it. */
export function sendNoticeFor(
  tab: Tab | null | undefined,
  runtimeInstances: RuntimeInstance[],
  startChatOn: (runtimeId: string) => void,
) {
  const runtimeId = tab?.runtimeId

  if (tab?.sendBlocked !== 'local_runtime_owner_only' || tab.readOnly || !runtimeId) return
  if (!isLocalAgentRuntime(runtimeId)) return
  // The catalog lists only the agents this viewer may run on; a new chat starts only on a usable one.
  const computer = runtimeInstances.find((instance) => instance.id === runtimeId)

  return {
    label: t('This agent runs on its owner’s computer, so only they can send messages here.'),
    ...(computer &&
      usable(computer) && {
        action: {
          label: t('Start your own chat on this computer'),
          onSelect: () => startChatOn(runtimeId),
        },
      }),
  }
}
