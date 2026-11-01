// A conversation's own desktop on its Box, streamed to the conversation's owner:
// the client's WebSocket carries RFB bytes as base64 text frames, which the
// device tunnel relays to the host's VNC server for that display: a Box's Xvnc,
// or a Mac's own screen from the bundle's mac-screen-host (see the host's
// mac-screen.ts and vnc-stream.ts). The first frame
// tells the host the session, the display and the viewer; the host connects
// only if that display's lock is the session's. The viewer only watches until a
// control frame hands the desktop to them: this route drops their input
// messages until then, whatever their client does, and on a Box the host turns
// the frame into the lock that pauses the agent's input tools on that display.
// The stream closing hands it back. Links carry ids only: the route is the
// authorization, and it admits only the conversation's owner. That does not
// isolate desktops on a shared Box: every session there runs as one Unix user
// against an X server and VNC without authentication, so any agent on the Box
// can reach another session's display. The team accepts this until each
// session gets its own Unix user (see the host's desktop-session.mjs). A Mac
// asks for no account: it shows its screen only once "Let my phone see and
// control this Mac" is turned on at the Mac, and only to the Nuphos process that
// started its host.

import { getReadableConversation } from '@/lib/agent/db'
import { localRuntimeId, parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { openLocalDesktop } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'

import { clientInputFilter } from './rfb-client-input'
import { requireRuntimeInstance } from './runtime-catalog'

import type { LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'
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

/**
 * Whose desktop: a conversation's, by its session id, or a computer's own,
 * opened from its runtime without a conversation.
 */
export type DesktopOwner = string | { runtimeId: string }

/** The host's status rejects a longer session id (protocol.ts), which would drop the whole report. */
const MAX_SESSION_ID = 128

/**
 * The lock id a computer's own desktop goes by. It names the computer, not the
 * agent, so every agent on one Mac or Box opens the same desktop (a Mac has one
 * screen). No conversation id has this prefix, so the lock is never a session's.
 */
export function runtimeDesktopSessionId({ userId, deviceId }: LocalRuntimeRef): string {
  return `runtime:${localRuntimeId({ userId, deviceId, provider: 'claude-code' })}`
}

/** The runtime's computer, for one who may use it, with the desktops it reports; none where it has no pool. */
async function desktopHost(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  presence: ReturnType<typeof runtimePresenceStore>,
) {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref || sessionId.length > MAX_SESSION_ID) throw notFound()
  // The same access the runtime terminal requires; a local runtime admits only its owner.
  await requireRuntimeInstance(teamId, runtimeId, userId)
  const status = (await presence.get(ref.userId, ref.deviceId))?.status

  return { ref, sessionId, desktops: status?.desktops, canOpen: status?.desktopOpen === true }
}

/** The conversation's Box for its owner, or a computer for the person it belongs to. */
async function ownedDesktopHost(
  teamId: string,
  userId: string,
  owner: DesktopOwner,
  presence: ReturnType<typeof runtimePresenceStore>,
) {
  if (typeof owner !== 'string') {
    const ref = parseLocalRuntimeId(owner.runtimeId)

    // Only the computer's own person; a team Box's other members open theirs through a conversation.
    if (ref?.userId !== userId) throw notFound()

    return desktopHost(teamId, userId, owner.runtimeId, runtimeDesktopSessionId(ref), presence)
  }
  const conversation = await getReadableConversation(owner, userId, teamId)

  if (!conversation?.runtimeId || conversation.userId !== userId || conversation.teamId !== teamId)
    throw notFound()

  return desktopHost(teamId, userId, conversation.runtimeId, owner, presence)
}

/** The owner, for a display the host reports as held by this conversation or computer. */
export async function runtimeDesktopTarget(
  teamId: string,
  userId: string,
  owner: DesktopOwner,
  displayParam: string,
  presence = runtimePresenceStore(),
): Promise<RuntimeDesktopTarget> {
  const display = Number(displayParam)
  const { ref, sessionId, desktops = [] } = await ownedDesktopHost(teamId, userId, owner, presence)

  if (!desktops.some((desktop) => desktop.display === display && desktop.sessionId === sessionId))
    throw notFound()

  return { userId: ref.userId, deviceId: ref.deviceId, teamId, sessionId, display, viewer: userId }
}

/**
 * The owner opens the desktop by hand: the Box claims a display from the same
 * pool the agent's desktop tool does, or answers the one already held (a Mac
 * hands over its screen). It then shows up in the runtime snapshot like any other.
 */
export async function openRuntimeDesktop(
  teamId: string,
  userId: string,
  owner: DesktopOwner,
  deps: { presence?: ReturnType<typeof runtimePresenceStore>; open?: typeof openLocalDesktop } = {},
): Promise<{ display: number }> {
  const {
    ref,
    sessionId,
    desktops = [],
    canOpen,
  } = await ownedDesktopHost(teamId, userId, owner, deps.presence ?? runtimePresenceStore())

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
        if (typeof data !== 'string') return
        input.server(Buffer.from(data, 'base64'))
        ws.send(data)
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
