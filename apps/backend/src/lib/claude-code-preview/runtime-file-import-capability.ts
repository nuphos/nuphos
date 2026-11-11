import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { AppError } from '@/lib/errors'

import { controlRegistry } from './agent-chat-registry'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

export async function assertRuntimeFileImportSupported(
  teamId: string,
  userId: string,
  runtimeId: string,
) {
  const instance = await requireRuntimeInstance(teamId, runtimeId, userId)

  if (instance.kind === 'local') {
    const ref = parseLocalRuntimeId(runtimeId)
    const presence = ref && (await runtimePresenceStore().get(ref.userId, ref.deviceId))

    if (!presence?.status?.fileImport)
      throw new AppError(
        409,
        'file_import_unsupported',
        'Update the destination Desktop before importing workspace files, or export without files',
      )

    return
  }
  const endpoint =
    instance.kind === 'development'
      ? developmentRuntimeEndpoint(instance.provider, 'control')
      : (await resolveTeamRuntimeEndpoints(teamId, undefined, instance.provider, 'control')).find(
          (item) => item.runtimeId === runtimeId,
        )

  if (endpoint) await controlRegistry.acquire(teamId, endpoint)
  if (!endpoint || !controlRegistry.runtimeJobs(teamId, endpoint).includes('panel'))
    throw new AppError(
      409,
      'file_import_unsupported',
      'The destination agent does not support workspace file imports. Choose another agent or export without files.',
    )
}
