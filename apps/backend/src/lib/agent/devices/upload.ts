import { z } from 'zod'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { createTransfer, finalizeTransfer, releaseTransfer } from '@/lib/file-transfer/service'
import { logEvent } from '@/lib/observability'

import { deviceAccessDeps } from './box-access'
import { tunnelBus } from './local-runtime/bus'
import { runtimePresenceStore } from './local-runtime/presence'
import { DeviceRuntimeSocket } from './local-runtime/socket'
import { requireShellAccess } from './manage-access'

import type { DeviceAccessDeps } from './box-access'
import type { DeviceRuntimeSocketDeps } from './local-runtime/socket'
import type { TransferScope } from '@/lib/file-transfer/service'

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
  // The team's hourly transfer budget (file-transfer/admission.ts). Without it the
  // agent saw a reasonless upload_failed and kept retrying until the hour turned.
  'file_transfer_rate_limited',
])

export type LocalUploadError = {
  error: string
  /** Plain words the agent can pass on. Written here, never a raw service message. */
  message?: string
  /** ISO time the team's hourly transfer limit resets. */
  retryAfter?: string
}
export type LocalUploadResult =
  { groupId: string; fileName: string; size: number } | LocalUploadError

function errorFrom(error: unknown): LocalUploadError {
  if (!(error instanceof AppError) || !transferErrors.has(error.code))
    return { error: 'upload_failed' }
  if (error.code !== 'file_transfer_rate_limited') return { error: error.code }
  const details = error.details as { retryAfter?: unknown } | undefined
  const retryAfter =
    typeof details?.retryAfter === 'string' && !Number.isNaN(Date.parse(details.retryAfter))
      ? new Date(details.retryAfter).toISOString()
      : undefined

  return {
    error: error.code,
    message: retryAfter
      ? `This team used its hourly file-transfer limit. It resets at ${retryAfter.slice(11, 16)} UTC. Do not retry; tell the person.`
      : 'This team used its hourly file-transfer limit. It resets at the next hour. Do not retry; tell the person.',
    ...(retryAfter ? { retryAfter } : {}),
  }
}

/**
 * Answers as soon as the transfer exists; the bytes then travel from the
 * computer straight to storage while this stream stays open only to confirm
 * them. No request waits on the transfer, so its length is bounded by the
 * signed URL rather than by whichever proxy the caller came through. Whoever
 * pulls the group sees it pending, then ready or failed.
 *
 * Only intent metadata reaches the caller; signed capabilities are exchanged
 * directly with the computer on its private device stream.
 */
export async function dispatchLocalUpload(
  actorId: string,
  deviceId: string,
  path: string,
  scope: TransferScope,
  options: {
    deps?: DeviceRuntimeSocketDeps
    access?: DeviceAccessDeps
    transfers?: {
      create: typeof createTransfer
      finalize: typeof finalizeTransfer
      release?: typeof releaseTransfer
    }
    timeoutMs?: number
  } = {},
): Promise<LocalUploadResult> {
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
  const transfers = options.transfers ?? {
    create: createTransfer,
    finalize: finalizeTransfer,
    release: releaseTransfer,
  }

  return new Promise((resolve) => {
    let settled = false
    let groupId: string | undefined
    let confirmed = false
    let delivered = false
    let busy = false
    // A transfer whose file never arrived gives its hourly slot back, so a
    // failing upload the agent retries does not use up the team's limit. The
    // upload URLs only ever went to this computer's private stream.
    const release = async (id: string) => {
      if (!transfers.release) return
      try {
        await transfers.release(scope, id)
      } catch (error) {
        logEvent('warn', 'agent.local_upload.release_failed', {
          team_id: teamId,
          group_id: id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // A transfer nobody confirmed is checked against storage, which marks an
    // object that never arrived as failed for whoever pulls it; only then, and
    // only if it did not arrive, is its slot given back. A check that fails
    // proves nothing, so it keeps the slot.
    const check = async (id: string) => {
      const view = await transfers.finalize(scope, id).catch(() => undefined)

      if (view && view.status !== 'ready') await release(id)
    }
    // Ends the stream. Before the transfer exists this is the caller's answer;
    // after it, the caller already has its answer and this runs in the background.
    const finish = (result?: LocalUploadError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (!groupId) resolve(result ?? { error: 'upload_failed' })
      else if (!confirmed) void check(groupId)
      // The computer confirmed, but storage did not have the file.
      else if (!delivered) void release(groupId)
    }
    // The caller waits only until the transfer exists; the bytes then get as
    // long as the signed URL they travel on.
    let timer = setTimeout(() => {
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
            finish({ error: 'upload_not_ready' })

            return
          }
          if (busy || message.t !== 'post') {
            finish({ error: 'invalid_upload_response' })

            return
          }
          busy = true
          let result: unknown

          if (message.suffix === '' && !groupId) {
            const { files } = intent.parse(message.body)
            const created = await transfers.create(scope, 'upload', files)

            if (settled) {
              // The caller was already answered with an error; do not leave it
              // pending, and give back the slot of a transfer nobody can use.
              void check(created.groupId)

              return
            }
            groupId = created.groupId
            result = created
            clearTimeout(timer)
            timer = setTimeout(finish, config.fileTransfer.presignExpirySeconds * 1000)
            resolve({ groupId, fileName: files[0]!.fileName, size: files[0]!.size })
          } else if (groupId && message.suffix === `/${groupId}/finalize` && !confirmed) {
            const view = await transfers.finalize(scope, groupId)

            result = view
            confirmed = true
            delivered = view.status === 'ready'
          } else {
            finish({ error: 'invalid_upload_request' })

            return
          }
          busy = false
          if (!settled) socket.send(JSON.stringify({ result }))
        } catch (error) {
          finish(errorFrom(error))
        }
      })()
    })
    void socket.connect().catch(() => {
      finish({ error: 'device_unavailable' })
    })
  })
}
