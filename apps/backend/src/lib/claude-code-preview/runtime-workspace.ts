import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { GridFSBucket } from 'mongodb'

import { config } from '@/config'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { provisionerKubeClient } from './provisioner-kube'
import { execRuntimeCommand } from './runtime-login-exec'
import { workspaceArchives } from './runtime-portability-store'
import { runtimeProvider } from './runtime-provider'
import { findHostedRuntime } from './runtime-registry'
import { runtimeServiceName } from './runtime-service-name'
import { WORKSPACE_ARCHIVE_PROGRAM } from './workspace-archive-program'

import type { WorkspaceArchive } from './runtime-portability-store'
import type { OpenAbProvider } from './runtime-provider'

function workspaceError(output: string): AppError {
  let code: unknown

  try {
    code = (JSON.parse(output) as { error?: unknown }).error
  } catch {
    /* Transport ended before a response. */
  }
  const messages: Record<string, string> = {
    limit:
      'This workspace exceeds the backup limit of 64 MiB or 10,000 entries. Remove generated files before retrying.',
    external_link:
      'This workspace links to files outside the conversation. Copy those files into the workspace before retrying.',
    destination_not_empty:
      'The destination already contains different files for this conversation. Choose another agent to avoid overwriting them.',
    changed:
      'Workspace files changed while they were being saved. Wait for background tasks to finish and retry.',
    integrity:
      'The workspace archive failed its integrity check. The destination was not replaced.',
  }

  const message = typeof code === 'string' ? messages[code] : undefined

  return new AppError(
    409,
    'workspace_transfer_failed',
    message ??
      'Could not transfer this workspace. Check that the agent is reachable, then retry. You can also move using conversation history only.',
  )
}

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const bucket = () => new GridFSBucket(db(), { bucketName: 'agent_workspace_files' })
const archiveKey = (teamId: string, sessionId: string, runtimeUrl: string) =>
  createHash('sha256')
    .update(JSON.stringify([teamId, sessionId, runtimeUrl]))
    .digest('hex')

export async function managedWorkspacePlacement(
  teamId: string,
  provider: OpenAbProvider,
  runtimeUrl: string,
) {
  const namespace = config.claudeCodeRuntimeProvisioner.namespace

  if (!provisionerKubeClient())
    throw new AppError(
      409,
      'workspace_unavailable',
      'Workspace transfer is not available for an external agent.',
    )
  const hosted = await findHostedRuntime(teamId, runtimeUrl)
  const deployment =
    hosted && runtimeProvider(hosted.provider) === provider
      ? runtimeServiceName(runtimeUrl, namespace)
      : null

  if (!deployment)
    throw new AppError(
      409,
      'workspace_unavailable',
      'Workspace transfer requires a managed agent in this environment.',
    )

  return { namespace, deployment }
}

export async function findWorkspaceArchive(teamId: string, sessionId: string, runtimeUrl: string) {
  return workspaceArchives().findOne({
    _id: archiveKey(teamId, sessionId, runtimeUrl),
    teamId,
    sessionId,
    runtimeUrl,
  })
}

export async function saveRuntimeWorkspace(
  teamId: string,
  sessionId: string,
  provider: OpenAbProvider,
  runtimeUrl: string,
): Promise<WorkspaceArchive> {
  const placement = await managedWorkspacePlacement(teamId, provider, runtimeUrl)
  let output = ''

  await execRuntimeCommand(
    placement.namespace,
    placement.deployment,
    [
      'node',
      '--input-type=module',
      '-e',
      WORKSPACE_ARCHIVE_PROGRAM,
      'export',
      '/workspace',
      sessionId,
    ],
    (chunk) => {
      output += chunk
      if (Buffer.byteLength(output) > MAX_ARCHIVE_BYTES)
        throw new Error('Workspace archive exceeds the supported size')
    },
    AbortSignal.timeout(120_000),
  ).catch(() => {
    throw workspaceError(output)
  })
  const data = Buffer.from(output)
  const parsed = JSON.parse(output) as { version?: number; sessionId?: string; entries?: unknown[] }

  if (parsed.version !== 1 || parsed.sessionId !== sessionId || !Array.isArray(parsed.entries))
    throw new Error('Invalid workspace archive')
  const upload = bucket().openUploadStream('workspace.json', { metadata: { teamId, sessionId } })

  try {
    await pipeline(Readable.from([data]), upload)
    const archive: WorkspaceArchive = {
      _id: archiveKey(teamId, sessionId, runtimeUrl),
      teamId,
      sessionId,
      runtimeUrl,
      fileId: upload.id,
      sha256: createHash('sha256').update(data).digest('hex'),
      size: data.length,
      createdAt: new Date(),
    }
    const previous = await workspaceArchives().findOneAndReplace(
      { _id: archive._id, teamId },
      archive,
      { upsert: true, returnDocument: 'before' },
    )

    if (previous)
      await bucket()
        .delete(previous.fileId)
        .catch((error: unknown) => {
          logError('runtime.archive.previous_cleanup_failed', error, {
            team_id: teamId,
            session_id: sessionId,
          })
        })

    return archive
  } catch (error) {
    // Incomplete uploads are never referenced by an archive manifest.
    await upload.abort().catch(() => {})
    await bucket()
      .delete(upload.id)
      .catch(() => {})
    throw error
  }
}

export async function restoreRuntimeWorkspace(
  archive: WorkspaceArchive,
  provider: OpenAbProvider,
  targetUrl: string,
) {
  const placement = await managedWorkspacePlacement(archive.teamId, provider, targetUrl)
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of bucket().openDownloadStream(archive.fileId)) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive storage stream')
    size += chunk.length
    if (size > MAX_ARCHIVE_BYTES) throw new Error('Workspace archive exceeds the supported size')
    chunks.push(chunk)
  }
  const data = Buffer.concat(chunks)

  if (size !== archive.size || createHash('sha256').update(data).digest('hex') !== archive.sha256)
    throw new Error('Workspace archive integrity check failed')
  let output = ''

  await execRuntimeCommand(
    placement.namespace,
    placement.deployment,
    [
      'node',
      '--input-type=module',
      '-e',
      WORKSPACE_ARCHIVE_PROGRAM,
      'import',
      '/workspace',
      archive.sessionId,
      String(data.length),
    ],
    (chunk) => {
      output += chunk
      if (output.length > 100) throw new Error('Invalid restore response')
    },
    AbortSignal.timeout(120_000),
    data,
  ).catch(() => {
    throw workspaceError(output)
  })
  if (output !== 'restored') throw new Error('Workspace restore did not finish')
}
