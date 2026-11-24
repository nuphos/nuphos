// A conversation's own desktop on its Box, streamed to the conversation's owner:
// the client's WebSocket carries RFB bytes as base64 text frames, which the
// device tunnel relays to the host's VNC server for that display: a Box's Xvnc,
// or a Mac's own screen from the bundle's mac-screen-host (see the host's
// mac-screen.ts and vnc-stream.ts). The first frame tells the host the session,
// the display and the viewer; the host connects only if that display's lock is
// the session's. The viewer only watches until a control frame hands the desktop
// to them: this route drops their input messages until then, whatever their
// client does, and on a Box the host turns the frame into the lock that pauses
// the agent's input tools on that display. The stream closing hands it back.
// Links carry ids only: the route is the authorization. It admits the owner, and a
// teammate who may reply in it to watch; they take over only what a `computer` card hands.
// That does not isolate desktops on a shared Box: every session there runs as one
// Unix user against an X server and VNC without authentication, so any agent on
// the Box can reach another session's display. The team accepts this until each
// session gets its own Unix user (see the host's desktop-session.mjs). A Mac asks
// for no account: it shows its screen only to the Nuphos process that started
// its host, and that process streams it only to the account signed in on the Mac.
import { getReadableConversation } from '@/lib/agent/db'
import { markDesktopTakenOver } from '@/lib/agent/db/desktop-takeover'
import { allows, deviceAccess } from '@/lib/agent/devices/box-access'
import { localRuntimeId, parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { openLocalDesktop } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { getAgentDevice } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { desktopInvitation, INVITE_RECHECK_MS, recheckInvitation } from './desktop-invitation'
import { clientInputFilter } from './rfb-client-input'
import { requireRuntimeInstance } from './runtime-catalog'

import type { Invited } from './desktop-invitation'
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
  /** A dock browser tab instead of a display: the Desktop's `browserView` stream serves it. */
  tab?: { id: string; width: number; height: number }
  /** A teammate who may reply: they watch, and take over while an open `computer` card names the display. */
  invited?: Invited
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

/** The computer's desktops as its host reports them; none where it has no pool. */
async function desktopHost(
  ref: LocalRuntimeRef,
  sessionId: string,
  presence: ReturnType<typeof runtimePresenceStore>,
  invited?: Invited,
) {
  if (sessionId.length > MAX_SESSION_ID) throw notFound()
  const status = (await presence.get(ref.userId, ref.deviceId))?.status

  return {
    ref,
    sessionId,
    desktops: status?.desktops,
    canOpen: status?.desktopOpen === true,
    invited,
  }
}

/**
 * The conversation's Box for its owner, or a computer for the person it belongs to.
 * With `display`, also for a teammate who may reply in the conversation.
 */
async function ownedDesktopHost(
  teamId: string,
  userId: string,
  owner: DesktopOwner,
  presence: ReturnType<typeof runtimePresenceStore>,
  display?: number,
) {
  if (typeof owner !== 'string') {
    const ref = parseLocalRuntimeId(owner.runtimeId)

    if (!ref) throw notFound()
    // The computer itself, with or without an agent on it.
    const device = await getAgentDevice(ref.userId, ref.deviceId)

    // Someone's own computer opens only for them. A Box opens only in its own team, for
    // whoever manages it there, as its desktop always did; its other members open theirs
    // through a conversation.
    if (
      !device ||
      !(device.box ? allows(deviceAccess(device, userId, teamId), 'manage') : ref.userId === userId)
    )
      throw notFound()

    return desktopHost(ref, runtimeDesktopSessionId(ref), presence)
  }
  const conversation = await getReadableConversation(owner, userId, teamId)

  if (!conversation?.runtimeId || conversation.teamId !== teamId) throw notFound()
  const ref = parseLocalRuntimeId(conversation.runtimeId)

  if (!ref) throw notFound()
  if (conversation.userId !== userId) {
    const invited =
      display === undefined
        ? undefined
        : await desktopInvitation(conversation, ref, display, userId)

    if (!invited) throw notFound()

    return desktopHost(ref, owner, presence, invited)
  }
  // The same access the runtime terminal requires; a local runtime admits only its owner.
  await requireRuntimeInstance(teamId, conversation.runtimeId, userId)

  return desktopHost(ref, owner, presence)
}

/** The owner or an invited teammate, for a display the host reports as held by this conversation or computer. */
export async function runtimeDesktopTarget(
  teamId: string,
  userId: string,
  owner: DesktopOwner,
  displayParam: string,
  presence = runtimePresenceStore(),
): Promise<RuntimeDesktopTarget> {
  const display = Number(displayParam)
  const host = await ownedDesktopHost(teamId, userId, owner, presence, display)
  const { ref, sessionId, invited } = host

  if (
    !(host.desktops ?? []).some(
      (desktop) => desktop.display === display && desktop.sessionId === sessionId,
    )
  )
    throw notFound()

  return {
    userId: ref.userId,
    deviceId: ref.deviceId,
    teamId,
    sessionId,
    display,
    viewer: userId,
    ...(invited && { invited }),
  }
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
  const { ref, sessionId, canOpen } = await ownedDesktopHost(
    teamId,
    userId,
    owner,
    deps.presence ?? runtimePresenceStore(),
  )

  // Only a host whose bundle opens desktops on request says so.
  if (!canOpen) throw notFound()
  // Always the host, even for a display it reports held: its desktop may have
  // exited since (a Mac's screen host leaves a minute after its last viewer,
  // while the lock stays for three), and opening brings it back.
  const target = { userId: ref.userId, actorId: userId, deviceId: ref.deviceId, teamId }

  return { display: await (deps.open ?? openLocalDesktop)(target, sessionId) }
}

/** Relays the client's frames to one `vnc` stream on the Box's tunnel and back. */
export function runtimeDesktopEvents(
  target: RuntimeDesktopTarget,
  deps: DeviceRuntimeSocketDeps & {
    invitedNow?: () => Promise<Invited | undefined>
    recheckMs?: number
  } = {
    bus: tunnelBus(),
    presence: runtimePresenceStore(),
  },
): WSEvents {
  const { sessionId, display, viewer, tab, invited, ...device } = target
  // The card gone, a teammate only watches; no longer able to reply, their stream ends.
  const invitedNow =
    deps.invitedNow ??
    (async () =>
      (await runtimeDesktopTarget(device.teamId, viewer, sessionId, `${display}`, deps.presence))
        .invited)
  let may = invited
  let stopRecheck = () => {}
  // The viewer is the actor: revoking them closes this stream and nobody else's.
  const stream = new DeviceRuntimeSocket(
    { ...device, actorId: viewer, purpose: tab ? 'browserView' : 'vnc' },
    deps,
  )
  const input = clientInputFilter()
  let holding = false
  const close = () => {
    stopRecheck()
    stream.close()
  }
  /** What goes on to the host: control frames as they are, RFB bytes minus input the viewer may not send yet. */
  const forward = (data: string): void => {
    if (data.startsWith('{')) {
      holding = (JSON.parse(data) as { owner?: string }).owner === 'human' && may !== 'view'
      stream.send(JSON.stringify({ t: 'control', owner: holding ? 'human' : 'agent' }))
      // A `computer` card for this display counts how long it was held.
      if (holding) void markDesktopTakenOver(sessionId, display).catch(() => {})

      return
    }
    const bytes = input.push(Buffer.from(data, 'base64'), holding)

    if (!bytes) throw new Error('Invalid desktop frame')
    if (bytes.length) stream.send(bytes.toString('base64'))
  }

  return {
    onOpen(_event, ws) {
      stream.addEventListener('open', () => {
        stream.send(
          JSON.stringify(
            tab
              ? { t: 'open', sessionId, tab: tab.id, width: tab.width, height: tab.height }
              : { t: 'open', sessionId, display, viewer },
          ),
        )
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
      if (invited)
        stopRecheck = recheckInvitation(invitedNow, deps.recheckMs ?? INVITE_RECHECK_MS, (now) => {
          may = now
          try {
            // The card answered or withdrawn: the Box goes back to the agent; they keep watching.
            if (may === 'view' && holding) forward('{"owner":"agent"}')
          } catch {
            may = undefined
          }
          if (may) return
          ws.close(1008, 'The invitation ended')
          close()
        })
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
