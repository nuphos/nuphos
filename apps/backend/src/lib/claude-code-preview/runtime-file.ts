import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { getReadableConversation } from '@/lib/agent/db'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'
import { createTransfer, finalizeTransfer, resolveDownloads } from '@/lib/file-transfer/service'

import { controlRegistry } from './agent-chat-registry'
import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { RUNTIME_FILE_PROGRAM } from './runtime-file-program'
import { parseRuntimeFile, parseRuntimeDirectory, parseRuntimeStat } from './runtime-file-codec'
export { parseRuntimeFile, parseRuntimeDirectory } from './runtime-file-codec'
export type { RuntimeDirectory } from './runtime-file-codec'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

const unavailable = () =>
  new AppError(
    503,
    'runtime_file_unavailable',
    'The source agent is offline or does not support file preview.',
  )

async function readLocalFile(
  teamId: string,
  actorId: string,
  runtimeId: string,
  input: string,
  timeoutMs: number,
): Promise<string> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref) throw unavailable()
  const socket = new DeviceRuntimeSocket(
    { ...ref, actorId, teamId, purpose: 'file' },
    { bus: tunnelBus(), presence: runtimePresenceStore() },
  )

  return new Promise((resolve, reject) => {
    const finish = (output?: string) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      socket.close()
      if (output === undefined) reject(unavailable())
      else resolve(output)
    }
    let settled = false
    const timer = setTimeout(() => {
      finish()
    }, timeoutMs)

    socket.addEventListener('open', () => {
      socket.send(input)
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

async function runtimeFileOperation(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
  request:
    | { action: 'read' | 'list' | 'stat' }
    | { action: 'upload'; url: string; size: number }
    | { action: 'import'; url?: string; size: number; sha256: string },
  timeoutMs = 10_000,
) {
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  // Reading a transcript does not grant access to its runtime filesystem.
  if (!conversation || conversation.teamId !== teamId || conversation.userId !== userId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  const instance = await requireRuntimeInstance(teamId, runtimeId, userId)

  if (instance.status !== 'active') throw unavailable()
  if (request.action === 'import' && instance.kind === 'local') {
    const ref = parseLocalRuntimeId(runtimeId)
    const presence = ref && (await runtimePresenceStore().get(ref.userId, ref.deviceId))

    if (!presence?.status?.fileImport)
      throw new AppError(
        409,
        'file_import_unsupported',
        'Update the destination Desktop to import workspace files',
      )
  }
  const endpoint =
    instance.kind === 'local'
      ? await resolveLocalRuntimeEndpoint(teamId, runtimeId, userId, 'control')
      : instance.kind === 'development'
        ? developmentRuntimeEndpoint(instance.provider, 'control')
        : (await resolveTeamRuntimeEndpoints(teamId, undefined, instance.provider, 'control')).find(
            (item) => item.runtimeId === runtimeId,
          )

  if (!endpoint) throw unavailable()
  if (
    conversation.runtimeId !== runtimeId &&
    !conversation.previousRuntimeUrls?.includes(endpoint.url)
  )
    throw new AppError(403, 'runtime_mismatch', 'This agent does not belong to the conversation.')
  const params = { path, ...request, workspace: '/workspace', sessionId }
  let output: string

  try {
    if (instance.kind === 'local')
      output = await readLocalFile(
        teamId,
        userId,
        runtimeId,
        JSON.stringify(params),
        timeoutMs + 5_000,
      )
    else {
      const client = await controlRegistry.acquire(teamId, endpoint)

      if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel')) throw unavailable()
      const result = await client.runJob(
        {
          jobId: randomUUID(),
          job: 'panel',
          env: {},
          stdin: JSON.stringify({ runner: RUNTIME_FILE_PROGRAM, script: '', params }),
          timeoutMs,
          maxStdoutBytes: 750_000,
        },
        timeoutMs + 5_000,
      )

      if (result.timedOut || typeof result.stdout !== 'string') throw unavailable()
      output = result.stdout
    }
  } catch {
    throw unavailable()
  }

  return output
}

export async function importRuntimeFile(input: {
  teamId: string
  userId: string
  runtimeId: string
  sessionId: string
  destination: string
  url?: string
  size: number
  sha256: string
}) {
  const output = await runtimeFileOperation(
    input.teamId,
    input.userId,
    input.runtimeId,
    input.sessionId,
    `imported/${input.sessionId}/${input.destination}`,
    { action: 'import', url: input.url, size: input.size, sha256: input.sha256 },
    110_000,
  )
  const result = JSON.parse(output) as { imported?: unknown; size?: unknown; sha256?: unknown }

  if (result.imported !== true || result.size !== input.size || result.sha256 !== input.sha256)
    throw unavailable()
}

export async function readRuntimeFile(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
) {
  return parseRuntimeFile(
    await runtimeFileOperation(teamId, userId, runtimeId, sessionId, path, { action: 'read' }),
  )
}

export async function listRuntimeFiles(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
) {
  return parseRuntimeDirectory(
    await runtimeFileOperation(teamId, userId, runtimeId, sessionId, path, { action: 'list' }),
  )
}

/**
 * Moves a file too large for the inline preview through the transfer store:
 * the runtime PUTs it to a presigned URL, and Files plays or renders it from a
 * presigned GET (which serves Range requests, so video seeks) or saves it. The
 * transfer belongs to the user, not the conversation, so opening a file in
 * Files does not add a download card to the chat.
 */
export async function shareRuntimeFile(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
) {
  const { name, size } = parseRuntimeStat(
    await runtimeFileOperation(teamId, userId, runtimeId, sessionId, path, { action: 'stat' }),
  )
  const scope = { teamId: new ObjectId(teamId), userId }
  const transfer = await createTransfer(scope, 'download', [{ fileName: name, size }])
  const [file] = transfer.files

  if (!file) throw unavailable()

  parseRuntimeStat(
    await runtimeFileOperation(
      teamId,
      userId,
      runtimeId,
      sessionId,
      path,
      { action: 'upload', url: file.uploadUrl, size },
      110_000,
    ),
  )
  if ((await finalizeTransfer(scope, transfer.groupId)).status !== 'ready') throw unavailable()
  const url = (await resolveDownloads(scope, transfer.groupId)).files[0]?.downloadUrl

  if (!url) throw unavailable()

  return { groupId: transfer.groupId, fileId: file.id, fileName: name, size, url }
}
