import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { resolveDownloads } from '@/lib/file-transfer/service'

import { deviceAccessDeps } from './box-access'
import { tunnelBus } from './local-runtime/bus'
import { runtimePresenceStore } from './local-runtime/presence'
import { DeviceRuntimeSocket } from './local-runtime/socket'
import { requireShellAccess } from './manage-access'

import type { DeviceAccessDeps } from './box-access'
import type { DeviceRuntimeSocketDeps } from './local-runtime/socket'
import type { TransferScope } from '@/lib/file-transfer/service'

export type LocalDownloadRequest = {
  groupId: string
  /** Which file of the group; needed only when it holds more than one. */
  fileName?: string
  path: string
  overwrite?: boolean
}

// What the computer may answer with; anything else reads as download_failed.
const hostErrors = new Set([
  'absolute_path_required',
  'directory_not_found',
  'not_a_file',
  'file_exists',
  'path_not_writable',
])
const transferErrors = new Set(['transfer_not_found', 'transfer_expired', 'invalid_id'])

type HostReply = { t?: string; path?: unknown; error?: string }

/** The one ready file of the group to save, or why there is none. */
async function pickFile(
  resolve: typeof resolveDownloads,
  scope: TransferScope,
  { groupId, fileName }: LocalDownloadRequest,
): Promise<{ url: string; size: number } | { error: string }> {
  let group

  try {
    group = await resolve(scope, groupId)
  } catch (error) {
    if (error instanceof AppError && transferErrors.has(error.code))
      return { error: error.code === 'invalid_id' ? 'transfer_not_found' : error.code }
    throw error
  }
  const named = fileName ? group.files.filter((file) => file.fileName === fileName) : group.files
  const [file] = named

  if (named.length !== 1 || !file)
    return { error: fileName ? 'file_not_in_transfer' : 'file_name_required' }
  if (!file.downloadUrl || file.size === null) return { error: 'transfer_not_ready' }

  return { url: file.downloadUrl, size: file.size }
}

/**
 * Saves one file of a transfer group onto a computer. The computer's own host fetches it,
 * so the signed URL travels only on its private device stream, never to the caller.
 */
export async function dispatchLocalDownload(
  actorId: string,
  deviceId: string,
  request: LocalDownloadRequest,
  scope: TransferScope,
  options: {
    deps?: DeviceRuntimeSocketDeps
    access?: DeviceAccessDeps
    transfers?: { resolve: typeof resolveDownloads }
  } = {},
): Promise<{ path: string; size: number } | { error: string }> {
  const access = options.access ?? deviceAccessDeps

  if (!(await access.role(actorId, scope.teamId.toHexString())))
    return { error: 'device_unavailable' }
  // It writes a file onto the computer, as a shell would.
  const device = await requireShellAccess(
    actorId,
    scope.teamId.toHexString(),
    deviceId,
    'exec',
    access,
  )

  if (!device.allowLocalExec) return { error: 'device_unavailable' }
  const file = await pickFile(options.transfers?.resolve ?? resolveDownloads, scope, request)

  if ('error' in file) return file
  const { url, size } = file
  const deps = options.deps ?? { bus: tunnelBus(), presence: runtimePresenceStore() }
  const presence = await deps.presence.get(device.userId, deviceId)

  if (!presence) return { error: 'device_unavailable' }
  if (presence.status?.localDownload !== true) return { error: 'update_required' }

  return new Promise((resolve) => {
    const socket = new DeviceRuntimeSocket(
      {
        userId: device.userId,
        actorId,
        deviceId,
        teamId: scope.teamId.toHexString(),
        purpose: 'download',
      },
      deps,
    )
    let settled = false
    const finish = (result: { path: string; size: number } | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve(result)
    }
    // No transfer outlives its signed URL.
    const timer = setTimeout(() => {
      finish({ error: 'download_timeout' })
    }, config.fileTransfer.presignExpirySeconds * 1000)

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          url,
          size,
          path: request.path,
          overwrite: request.overwrite === true,
        }),
      )
    })
    socket.addEventListener('close', () => {
      finish({ error: 'device_disconnected' })
    })
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as HostReply

        if (message.t === 'done' && typeof message.path === 'string')
          finish({ path: message.path, size })
        else
          finish({
            error:
              message.error && hostErrors.has(message.error) ? message.error : 'download_failed',
          })
      } catch {
        finish({ error: 'download_failed' })
      }
    })
    void socket.connect().catch(() => {
      finish({ error: 'device_unavailable' })
    })
  })
}
