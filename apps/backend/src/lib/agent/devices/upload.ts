import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { createTransfer, finalizeTransfer } from '@/lib/file-transfer/service'

import { deviceAccessDeps } from './box-access'
import { tunnelBus } from './local-runtime/bus'
import { runtimePresenceStore } from './local-runtime/presence'
import { DeviceRuntimeSocket } from './local-runtime/socket'
import { requireShellAccess } from './manage-access'

import type { DeviceAccessDeps } from './box-access'
import type { DeviceRuntimeSocketDeps } from './local-runtime/socket'
import type { TransferGroupView, TransferScope } from '@/lib/file-transfer/service'

const intent = z.object({
  direction: z.literal('upload'),
  files: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(512),
        relPath: z.string().trim().min(1).max(1024),
        size: z.number().int().positive(),
        contentType: z.string().max(255).nullable(),
      }),
    )
    .length(1),
})
const fileErrors = new Set([
  'absolute_path_required',
  'not_a_file',
  'file_not_found',
  'file_unreadable',
])
const transferErrors = new Set([
  'file_too_large',
  'transfer_too_large',
  'transfer_expired',
  'file_transfer_unconfigured',
])

/** Only intent metadata and completion reach the caller; signed capabilities
 * are exchanged directly with the computer on its private device stream. */
export async function dispatchLocalUpload(
  actorId: string,
  deviceId: string,
  path: string,
  scope: TransferScope,
  options: {
    deps?: DeviceRuntimeSocketDeps
    access?: DeviceAccessDeps
    transfers?: { create: typeof createTransfer; finalize: typeof finalizeTransfer }
    timeoutMs?: number
  } = {},
): Promise<{ groupId: string; fileName: string; size: number } | { error: string }> {
  const access = options.access ?? deviceAccessDeps
  const teamId = scope.teamId.toHexString()

  if (!(await access.role(actorId, teamId))) return { error: 'device_unavailable' }
  // It reads a file off the computer, as a shell would.
  const device = await requireShellAccess(actorId, teamId, deviceId, 'exec', access)

  if (!device.allowLocalExec) return { error: 'device_unavailable' }
  const socket = new DeviceRuntimeSocket(
    { userId: device.userId, actorId, deviceId, teamId, purpose: 'upload' },
    options.deps ?? { bus: tunnelBus(), presence: runtimePresenceStore() },
  )
  const transfers = options.transfers ?? { create: createTransfer, finalize: finalizeTransfer }

  return new Promise((resolve) => {
    let settled = false
    let groupId: string | undefined
    let ready: TransferGroupView | undefined
    let busy = false
    const finish = (
      result: { groupId: string; fileName: string; size: number } | { error: string },
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve(result)
    }
    const timer = setTimeout(() => {
      finish({ error: 'upload_timeout' })
    }, options.timeoutMs ?? 120_000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ path }))
    })
    socket.addEventListener('close', () => {
      finish({ error: 'device_disconnected_or_update_required' })
    })
    socket.addEventListener('message', (event) => {
      void (async () => {
        if (settled) return
        try {
          const message = JSON.parse(String(event.data))

          if (message.t === 'error') {
            finish({
              error: fileErrors.has(message.error) ? message.error : 'upload_failed',
            })

            return
          }
          if (message.t === 'done') {
            const file = ready?.files[0]

            if (
              !ready ||
              ready.status !== 'ready' ||
              !file ||
              file.status !== 'ready' ||
              file.size === null
            ) {
              finish({ error: 'upload_not_ready' })

              return
            }
            finish({ groupId: ready.groupId, fileName: file.fileName, size: file.size })

            return
          }
          if (busy || message.t !== 'post') {
            finish({ error: 'invalid_upload_response' })

            return
          }
          busy = true
          let result: unknown

          if (message.suffix === '' && !groupId) {
            const body = intent.parse(message.body)
            const created = await transfers.create(scope, 'upload', body.files)

            groupId = created.groupId
            result = created
          } else if (groupId && message.suffix === `/${groupId}/finalize` && !ready) {
            ready = await transfers.finalize(scope, groupId)
            result = ready
          } else {
            finish({ error: 'invalid_upload_request' })

            return
          }
          busy = false
          if (!settled) socket.send(JSON.stringify({ result }))
        } catch (error) {
          finish({
            error:
              error instanceof AppError && transferErrors.has(error.code)
                ? error.code
                : 'upload_failed',
          })
        }
      })()
    })
    void socket.connect().catch(() => {
      finish({ error: 'device_unavailable' })
    })
  })
}
