import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'

import { runtimeVersionAtLeast, stableRuntimeVersion } from './runtime-release'

import type { RuntimeAttachment } from './runtime-attachment-types'
import type { DeviceRuntimeSocketDeps } from '@/lib/agent/devices/local-runtime/socket'

/**
 * The first Desktop whose bundled attachment program accepts a `data:` URL —
 * how a secret typed into the secure input card reaches the computer (#1019).
 * An older one drops the stream without an answer, which reads as a bare
 * failure the user can only retry, forever.
 */
export const INLINE_SECRET_MIN_DESKTOP = '0.95.0'

/** `nuphos-desktop/0.94.0` → `0.94.0`. A CLI host, a dev build or an unparseable
 *  value is unknown, and an unknown host keeps the behaviour it had before. */
function desktopVersion(client: string | undefined): string | undefined {
  const [app, version] = client?.split('/') ?? []

  return app === 'nuphos-desktop' && stableRuntimeVersion(version) ? version : undefined
}

/** A Desktop too old to take a secret inline; nothing else is affected. */
function inlineSecretRefused(
  client: string | undefined,
  files: readonly RuntimeAttachment[],
): boolean {
  if (!files.some((file) => file.url.startsWith('data:'))) return false
  const version = desktopVersion(client)

  return version !== undefined && !runtimeVersionAtLeast(version, INLINE_SECRET_MIN_DESKTOP)
}

/** New Desktop clients run only their bundled downloader over their authenticated tunnel. */
export async function localAttachments(
  teamId: string,
  actorId: string,
  runtimeId: string | undefined,
  files: RuntimeAttachment[],
  deps: DeviceRuntimeSocketDeps = { bus: tunnelBus(), presence: runtimePresenceStore() },
): Promise<string | null> {
  const ref = runtimeId ? parseLocalRuntimeId(runtimeId) : undefined

  if (!ref) return null
  const presence = await deps.presence.get(ref.userId, ref.deviceId)

  // An older Desktop keeps using its allowlisted OpenAB job.
  if (presence?.status?.localAttachments !== true) return null
  // A distinct error, not a bare failure: only updating that computer can fix it.
  if (inlineSecretRefused(presence.client, files))
    throw new AppError(
      409,
      'runtime_outdated',
      `The computer running this agent needs Nuphos Desktop ${INLINE_SECRET_MIN_DESKTOP} or later to save a secret. Update Nuphos Desktop on that computer, then try again.`,
    )
  const socket = new DeviceRuntimeSocket({ ...ref, actorId, teamId, purpose: 'attachments' }, deps)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (output?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (output === undefined || output.length > 64 * 1024)
        reject(new Error('Could not prepare attachments on the runtime. Retry this message.'))
      else resolve(output)
    }
    const timer = setTimeout(() => {
      finish()
    }, 125_000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ files }))
    })
    socket.addEventListener('message', ({ data }) => {
      finish(typeof data === 'string' ? data : undefined)
    })
    socket.addEventListener('close', () => {
      finish()
    })
    void socket.connect()
  })
}
