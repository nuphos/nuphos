import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'

import type { RuntimeAttachment } from './runtime-attachment-types'
import type { DeviceRuntimeSocketDeps } from '@/lib/agent/devices/local-runtime/socket'

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
