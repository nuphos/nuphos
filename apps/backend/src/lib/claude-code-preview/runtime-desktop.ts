// A conversation's own desktop on its Box, streamed to the conversation's owner:
// the client's WebSocket carries RFB bytes as base64 text frames, which the
// device tunnel relays to the host's Xvnc for that display (see the host's
// vnc-stream.ts). The first frame tells the host the session, the display and
// the viewer; the host connects only if that display's lock is the session's.
// The viewer only watches until a control frame hands the desktop to them: this
// route drops their input messages until then, whatever their client does, and
// the host turns the frame into the lock that pauses the agent's input tools on
// that display. The stream closing hands it back. Links carry ids only: the
// route is the authorization, and it admits only the conversation's owner. That
// does not isolate desktops on a shared Box: every session there runs as one Unix
// user against an X server and VNC without authentication, so any agent on the
// Box can reach another session's display. The team accepts this until each
// session gets its own Unix user (see the host's desktop-session.mjs).

import { getReadableConversation } from '@/lib/agent/db'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { openLocalDesktop } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'

import { clientInputFilter } from './rfb-client-input'
import { requireRuntimeInstance } from './runtime-catalog'

import type { DeviceRuntimeSocketDeps } from '@/lib/agent/devices/local-runtime/socket'
import type { WSEvents } from 'hono/ws'

/** A client-to-server RFB message in base64 (a few bytes; a clipboard paste at most), or a control frame. */
const MAX_FRAME_CHARS = 64 * 1024

export type RuntimeDesktopTarget = {
  userId: string
  deviceId: string
  teamId: string
  sessionId: string
  display: number
  /** Who is watching: named in the lock when they take over, never a secret. */
  viewer: string
}

const notFound = () => new AppError(404, 'not_found', 'Conversation desktop not found')

/** The conversation's Box, for its owner, with the desktops that Box reports; none where it has no pool. */
async function ownedDesktopHost(
  teamId: string,
  userId: string,
  sessionId: string,
  presence: ReturnType<typeof runtimePresenceStore>,
) {
  const conversation = await getReadableConversation(sessionId, userId, teamId)
  const runtimeId = conversation?.runtimeId
  const ref = runtimeId ? parseLocalRuntimeId(runtimeId) : undefined

  if (!runtimeId || !ref || conversation?.userId !== userId || conversation.teamId !== teamId)
    throw notFound()
  // The same access the runtime terminal requires; a local runtime admits only its owner.
  await requireRuntimeInstance(teamId, runtimeId, userId)
  const status = (await presence.get(ref.userId, ref.deviceId))?.status

  return { ref, desktops: status?.desktops, canOpen: status?.desktopOpen === true }
}

/** The owner of the conversation, for a display the Box reports as this session's. */
export async function runtimeDesktopTarget(
  teamId: string,
  userId: string,
  sessionId: string,
  displayParam: string,
  presence = runtimePresenceStore(),
): Promise<RuntimeDesktopTarget> {
  const display = Number(displayParam)
  const { ref, desktops = [] } = await ownedDesktopHost(teamId, userId, sessionId, presence)

  if (!desktops.some((desktop) => desktop.display === display && desktop.sessionId === sessionId))
    throw notFound()

  return { userId: ref.userId, deviceId: ref.deviceId, teamId, sessionId, display, viewer: userId }
}

/**
 * The owner opens the conversation's desktop by hand: the Box claims a display
 * from the same pool the agent's desktop tool does, or answers the one the
 * session already holds. It then shows up in the runtime snapshot like any other.
 */
export async function openRuntimeDesktop(
  teamId: string,
  userId: string,
  sessionId: string,
  deps: { presence?: ReturnType<typeof runtimePresenceStore>; open?: typeof openLocalDesktop } = {},
): Promise<{ display: number }> {
  const {
    ref,
    desktops = [],
    canOpen,
  } = await ownedDesktopHost(teamId, userId, sessionId, deps.presence ?? runtimePresenceStore())

  // Only a host whose bundle opens desktops on request says so.
  if (!canOpen) throw notFound()
  const held = desktops.find((desktop) => desktop.sessionId === sessionId)

  if (held) return { display: held.display }
  const target = { userId: ref.userId, actorId: userId, deviceId: ref.deviceId, teamId }

  return { display: await (deps.open ?? openLocalDesktop)(target, sessionId) }
}

/** Relays the client's frames to one `vnc` stream on the Box's tunnel and back. */
export function runtimeDesktopEvents(
  target: RuntimeDesktopTarget,
  deps: DeviceRuntimeSocketDeps = { bus: tunnelBus(), presence: runtimePresenceStore() },
): WSEvents {
  const { sessionId, display, viewer, ...device } = target
  // The viewer is the actor: revoking them closes this stream and nobody else's.
  const stream = new DeviceRuntimeSocket({ ...device, actorId: viewer, purpose: 'vnc' }, deps)
  const input = clientInputFilter()
  let holding = false
  const close = () => {
    stream.close()
  }
  /** What goes on to the host: control frames as they are, RFB bytes minus input the viewer may not send yet. */
  const forward = (data: string): void => {
    if (data.startsWith('{')) {
      holding = (JSON.parse(data) as { owner?: string }).owner === 'human'
      stream.send(JSON.stringify({ t: 'control', owner: holding ? 'human' : 'agent' }))

      return
    }
    const bytes = input.push(Buffer.from(data, 'base64'), holding)

    if (!bytes) throw new Error('Invalid desktop frame')
    if (bytes.length) stream.send(bytes.toString('base64'))
  }

  return {
    onOpen(_event, ws) {
      stream.addEventListener('open', () => {
        stream.send(JSON.stringify({ t: 'open', sessionId, display, viewer }))
      })
      stream.addEventListener('message', ({ data }) => {
        if (typeof data === 'string') ws.send(data)
      })
      stream.addEventListener('close', () => {
        ws.close(1011, 'The desktop is gone')
      })
      void stream.connect()
    },
    onMessage(event, ws) {
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_FRAME_CHARS)
          throw new Error('Invalid desktop frame')
        forward(event.data)
      } catch {
        close()
        ws.close(1008, 'Invalid desktop frame')
      }
    },
    onClose: close,
    onError: close,
  }
}
