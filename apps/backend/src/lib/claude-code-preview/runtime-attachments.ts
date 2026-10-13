import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { ObjectId } from 'mongodb'

import { resolveDownloads } from '@/lib/file-transfer/service'

import { controlRegistry } from './agent-chat-registry'
import { resolveConversationChatRuntime } from './conversation-chat-route'
import { ATTACHMENT_RUNNER } from './runtime-attachment-runner'
import { uploadPromptImages } from './upload-prompt-images'

import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { PromptImage } from '../agent/image-parts'

export type RuntimeAttachment = {
  name: string
  url: string
  size: number
  mimeType?: string
  archive?: boolean
}
export type PromptAttachment = {
  type: 'resource_link'
  uri: string
  name: string
  mimeType?: string
  description?: string
}

/** Resolve only current-turn transfers, under the authenticated sender's scope. */
export async function runtimeAttachments(
  parts: readonly unknown[],
  scope: { teamId: string; userId: string; sessionId: string },
  images: PromptImage[],
): Promise<RuntimeAttachment[]> {
  const files: RuntimeAttachment[] = []
  const imageGroup = images.length
    ? await uploadPromptImages({ ...scope, teamId: new ObjectId(scope.teamId) }, images)
    : null
  const transfers = imageGroup
    ? [...parts, { type: 'transfer-upload', groupId: imageGroup }]
    : parts

  for (const raw of transfers) {
    if (!raw || typeof raw !== 'object') continue
    const part = raw as {
      type?: string
      groupId?: string
      status?: string
      archive?: boolean
      data?: unknown
    }
    const transfer = part.type === 'data-attachment' ? (part.data as typeof part) : part

    if (
      transfer?.type !== 'transfer-upload' ||
      !transfer.groupId ||
      (transfer.status && transfer.status !== 'ready')
    )
      continue
    const group = await resolveDownloads(
      {
        ...scope,
        teamId: new ObjectId(scope.teamId),
      },
      transfer.groupId,
    )

    for (const file of group.files) {
      if (file.status !== 'ready' || !file.downloadUrl || file.size == null)
        throw new Error('An attached file is not ready to download')
      files.push({
        name: file.fileName,
        ...(transfer.archive ? { archive: true } : {}),
        url: file.downloadUrl,
        size: file.size,
        ...(file.contentType ? { mimeType: file.contentType } : {}),
      })
    }
  }

  return files
}

/** Runs before the prompt: the model receives real local paths, never download instructions. */
export async function materializeRuntimeAttachments(
  teamId: string,
  ownerUserId: string,
  runtime: TeamRuntimeEndpoint,
  files: RuntimeAttachment[],
): Promise<PromptAttachment[]> {
  if (!files.length) return []
  // A runtime job needs the operator credential, which a turn's transport endpoint lacks.
  const { endpoint } = await resolveConversationChatRuntime(teamId, null, {
    userId: ownerUserId,
    ...(runtime.runtimeId ? { runtimeId: runtime.runtimeId } : {}),
    purpose: 'control',
  })

  if (endpoint.url !== runtime.url)
    throw new Error('Conversation runtime changed. Retry this message.')
  const client = await controlRegistry.acquire(teamId, endpoint)

  const jobs = controlRegistry.runtimeJobs(teamId, endpoint)
  // A Desktop local runtime runs only its bundled copy of the program, so just the file
  // list crosses; the image's general `panel` job takes the program as its runner.
  const job = jobs.includes('attachments') ? 'attachments' : jobs.includes('panel') ? 'panel' : null

  if (!job) throw new Error('Update this agent to support native file attachments')
  const result = await client.runJob(
    {
      jobId: randomUUID(),
      job,
      stdin: JSON.stringify(
        job === 'attachments'
          ? { files }
          : { runner: ATTACHMENT_RUNNER, script: '', params: { files } },
      ),
      env: {},
      timeoutMs: 120_000,
      maxStdoutBytes: 64 * 1024,
    },
    125_000,
  )

  if (result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string')
    throw new Error('Could not prepare attachments on the runtime. Retry this message.')
  const output = JSON.parse(result.stdout) as { paths?: unknown[] }

  if (
    !Array.isArray(output.paths) ||
    output.paths.length !== files.length ||
    !output.paths.every((path) => typeof path === 'string' && path.startsWith('/'))
  )
    throw new Error('The runtime returned invalid attachment paths')

  return output.paths.map((path, index) => ({
    type: 'resource_link',
    uri: pathToFileURL(String(path)).href,
    name: files[index]!.name,
    ...(files[index]!.archive
      ? {
          description:
            'Uploaded folder or file collection. Extract this local archive into a new directory in the conversation workspace before inspecting its contents.',
        }
      : {}),
    ...(files[index]!.mimeType ? { mimeType: files[index]!.mimeType } : {}),
  }))
}
