import { randomUUID } from 'node:crypto'

import { getReadableConversation } from '@/lib/agent/db'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'

import { controlRegistry } from './agent-chat-registry'
import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { RUNTIME_FILE_LIMIT, RUNTIME_FILE_PROGRAM } from './runtime-file-program'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

const unavailable = () =>
  new AppError(
    503,
    'runtime_file_unavailable',
    'The source agent is offline or does not support file preview.',
  )

async function readLocalFile(teamId: string, runtimeId: string, input: string): Promise<string> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref) throw unavailable()
  const socket = new DeviceRuntimeSocket(
    { ...ref, teamId, purpose: 'file' },
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
    }, 15_000)

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

export function parseRuntimeFile(output: string) {
  if (output.length > 750_000) throw unavailable()
  let result: { name?: unknown; data?: unknown; size?: unknown; error?: unknown }

  try {
    result = JSON.parse(output)
  } catch {
    throw unavailable()
  }
  if (!result || typeof result !== 'object') throw unavailable()
  const errors: Record<string, [400 | 403 | 404 | 413, string]> = {
    file_not_found: [404, 'The file no longer exists on this agent.'],
    forbidden_path: [403, 'Only files inside the source runtime workspace can be previewed.'],
    invalid_path: [400, 'Invalid file path.'],
    not_a_file: [400, 'This path is not a regular file.'],
    file_too_large: [413, 'File preview is limited to 512 KiB.'],
  }

  if (typeof result.error === 'string') {
    const failure = Object.hasOwn(errors, result.error) ? errors[result.error] : undefined

    if (failure) throw new AppError(failure[0], result.error, failure[1])
    throw unavailable()
  }
  if (
    typeof result.name !== 'string' ||
    typeof result.data !== 'string' ||
    typeof result.size !== 'number' ||
    !Number.isInteger(result.size) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data) ||
    result.size > RUNTIME_FILE_LIMIT ||
    result.size < 0 ||
    Buffer.from(result.data, 'base64').length !== result.size
  )
    throw unavailable()

  return { name: result.name, data: result.data, size: result.size }
}

async function runtimeFileOperation(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
  action: 'read' | 'list',
) {
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  // Reading a transcript does not grant access to its runtime filesystem.
  if (!conversation || conversation.teamId !== teamId || conversation.userId !== userId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  const instance = await requireRuntimeInstance(teamId, runtimeId, userId)

  if (instance.status !== 'active') throw unavailable()
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
  const params = { sessionId, path, action, workspace: '/workspace' }
  let output: string

  try {
    if (instance.kind === 'local')
      output = await readLocalFile(teamId, runtimeId, JSON.stringify(params))
    else {
      const client = await controlRegistry.acquire(teamId, endpoint)

      if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel')) throw unavailable()
      const result = await client.runJob(
        {
          jobId: randomUUID(),
          job: 'panel',
          env: {},
          stdin: JSON.stringify({ runner: RUNTIME_FILE_PROGRAM, script: '', params }),
          timeoutMs: 10_000,
          maxStdoutBytes: 750_000,
        },
        15_000,
      )

      if (result.timedOut || typeof result.stdout !== 'string') throw unavailable()
      output = result.stdout
    }
  } catch {
    throw unavailable()
  }

  return output
}

export async function readRuntimeFile(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
) {
  return parseRuntimeFile(
    await runtimeFileOperation(teamId, userId, runtimeId, sessionId, path, 'read'),
  )
}

export type RuntimeDirectory = {
  entries: { name: string; kind: 'directory' | 'file' }[]
  truncated: boolean
}

export function parseRuntimeDirectory(output: string): RuntimeDirectory {
  if (output.length > 750_000) throw unavailable()
  let result: RuntimeDirectory & { error?: string }

  try {
    result = JSON.parse(output)
  } catch {
    throw unavailable()
  }
  if (result?.error) {
    if (result.error === 'not_a_directory')
      throw new AppError(400, 'not_a_directory', 'This path is not a directory.')
    parseRuntimeFile(output)
  }
  if (
    !result ||
    !Array.isArray(result.entries) ||
    result.entries.length > 500 ||
    typeof result.truncated !== 'boolean' ||
    result.entries.some(
      (entry) =>
        !entry ||
        typeof entry.name !== 'string' ||
        !entry.name ||
        entry.name === '.' ||
        entry.name === '..' ||
        /[\\/\0]/.test(entry.name) ||
        !['file', 'directory'].includes(entry.kind),
    )
  )
    throw unavailable()

  return { entries: result.entries, truncated: result.truncated }
}

export async function listRuntimeFiles(
  teamId: string,
  userId: string,
  runtimeId: string,
  sessionId: string,
  path: string,
) {
  return parseRuntimeDirectory(
    await runtimeFileOperation(teamId, userId, runtimeId, sessionId, path, 'list'),
  )
}
