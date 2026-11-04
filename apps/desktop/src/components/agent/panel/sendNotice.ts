import { t } from '../../../i18n/index.ts'
import { usable } from '../../../lib/agentName.ts'
import { isLocalAgentRuntime } from '../../../lib/localAgentSharing.ts'

import type { Tab } from './model.ts'
import type { SendNotice } from './RuntimeSelector.tsx'
import type { RuntimeInstance } from '../../../types/runtime.ts'

/** Someone's own computer takes only its owner's turns (#667): say so before a
 *  send fails, and always offer one way on — a chat of the viewer's own, on that
 *  computer when they may use it, else on any agent they can; else set one up. */
export function sendNoticeFor(
  tab: Tab | null | undefined,
  runtimeInstances: RuntimeInstance[],
  startChatOn: (runtimeId: string) => void,
  setUpAgent: () => void,
  /** Only where a cloud computer can be made: creating one is an admin's, on a plan that has them. */
  addCloudRuntime?: () => void,
): SendNotice | undefined {
  const runtimeId = tab?.runtimeId

  if (tab?.sendBlocked !== 'local_runtime_owner_only' || tab.readOnly || !runtimeId) return
  if (!isLocalAgentRuntime(runtimeId)) return
  // The catalog lists only the agents this viewer may run on; a new chat starts only on a usable one.
  const runnable = runtimeInstances.filter(usable)
  const here = runnable.find((instance) => instance.id === runtimeId)
  const own = here ?? runnable[0]

  return {
    label: t('This agent runs with its owner’s own sign-in, so only they can send messages here.'),
    action: own
      ? {
          label: here ? t('Start your own chat on this computer') : t('Start your own chat'),
          onSelect: () => startChatOn(own.id),
        }
      : { label: t('Set up your agent'), onSelect: setUpAgent },
    ...(!own && addCloudRuntime
      ? { secondary: { label: t('Use a cloud runtime instead'), onSelect: addCloudRuntime } }
      : {}),
  }
}
