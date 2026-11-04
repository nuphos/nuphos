import { t } from '../../../i18n/index.ts'
import { usable } from '../../../lib/agentName.ts'
import { isLocalAgentRuntime } from '../../../lib/localAgentSharing.ts'

import type { Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

type NoticeAction = { label: string; onSelect: () => void }

/** One way on from someone else's agent this viewer can only read. */
export type ViewOnlyNotice = { action: NoticeAction; secondary?: NoticeAction }

/**
 * A teammate who can only read an agent on someone's computer (#1488) is never
 * left without a next step: their own chat, on that computer when they may use
 * it, else on any agent they can; with none, the setup a new user gets.
 */
export function viewOnlyNoticeFor(
  tab: Tab | null | undefined,
  runtimeInstances: RuntimeInstance[],
  startChatOn: (runtimeId: string) => void,
  setUpAgent: () => void,
  /** Only where a cloud computer can be made: creating one is an admin's, on a plan that has them. */
  addCloudRuntime?: () => void,
): ViewOnlyNotice | undefined {
  const runtimeId = tab?.runtimeId

  if (!tab?.readOnly || !tab.foreign || tab.slackThread || tab.auditForcedReadOnly) return
  if (!isLocalAgentRuntime(runtimeId)) return
  // The catalog lists only the agents this viewer may run on; a new chat starts only on a usable one.
  const runnable = runtimeInstances.filter(usable)
  const here = runnable.find((instance) => instance.id === runtimeId)
  const own = here ?? runnable[0]

  if (own)
    return {
      action: {
        label: here ? t('Start your own chat on this computer') : t('Start your own chat'),
        onSelect: () => startChatOn(own.id),
      },
    }

  return {
    action: { label: t('Set up your agent'), onSelect: setUpAgent },
    ...(addCloudRuntime
      ? { secondary: { label: t('Use a cloud runtime instead'), onSelect: addCloudRuntime } }
      : {}),
  }
}
