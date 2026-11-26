// A `computer` request hands the conversation's own desktop to a person: the
// Box opens it (or answers the one the agent already holds) as it does when
// the owner opens it by hand, and the card names that display.
import { getConversationBySessionId } from '@/lib/agent/db'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { getAgentDevice } from '@/lib/agent/devices/store'

import { openRuntimeDesktop } from './runtime-desktop'

import type { ComputerDesktop } from '@/lib/agent/db/pending-decision'

export const NO_DESKTOP =
  'This conversation has no desktop to hand over: it runs on a computer without a desktop pool, or that computer is offline. ' +
  'Ask with another category instead, e.g. a `credential` card for the details you need.'

/** The display a `computer` card shows, or why there is none. */
export async function computerDesktop(
  teamId: string,
  sessionId: string,
  open = openRuntimeDesktop,
): Promise<ComputerDesktop | string> {
  const conversation = await getConversationBySessionId(sessionId)
  const ref = conversation?.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!conversation || !ref) return NO_DESKTOP
  const device = await getAgentDevice(ref.userId, ref.deviceId)

  if (!device) return NO_DESKTOP
  const opened = await open(teamId, conversation.userId, sessionId).catch(() => undefined)

  if (!opened) return NO_DESKTOP

  return {
    deviceId: ref.deviceId,
    display: opened.display,
    title: device.label,
  }
}
