// A `computer` request hands the conversation's own desktop to a person: the
// Box opens it (or answers the one the agent already holds) as it does when
// the owner opens it by hand, and the card names that display. Only on a
// computer no one else uses, so the desktop a person signs in on stays theirs.
import { getConversationBySessionId } from '@/lib/agent/db'
import { onlyUsedBy } from '@/lib/agent/devices/box-access'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { getAgentDevice } from '@/lib/agent/devices/store'

import { openRuntimeDesktop } from './runtime-desktop'

import type { ComputerDesktop } from '@/lib/agent/db/pending-decision'

export const NO_DESKTOP =
  'This conversation has no desktop to hand over: it runs on a computer without a desktop pool, or that computer is offline. ' +
  'Ask with another category instead, e.g. a `credential` card for the details you need.'

export const SHARED_DESKTOP =
  'This conversation runs on a computer other people can use, so its desktop is not private to the person: do not hand it to them. ' +
  'Ask them to do that step on their own computer instead, with another category such as `preference`, and continue once they say it is done.'

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
  if (!onlyUsedBy(device, conversation.userId)) return SHARED_DESKTOP
  const opened = await open(teamId, conversation.userId, sessionId).catch(() => undefined)

  if (!opened) return NO_DESKTOP

  return {
    deviceId: ref.deviceId,
    display: opened.display,
    title: device.label,
  }
}
