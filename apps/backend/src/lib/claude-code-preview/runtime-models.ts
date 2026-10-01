import { z } from 'zod'

import { config } from '@/config'
import { agentConversations } from '@/lib/agent/db/shared'

import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { execRuntimeCommand } from './runtime-login-exec'
import { localRuntimeModels } from './local-runtime-catalog'
import { createRuntimeModelCatalog } from './runtime-model-cache'
import { RUNTIME_MODEL_PROBE } from './runtime-model-probe'
import { resolveTeamRuntimeEndpoints, runtimes } from './runtime-registry'
import { runtimeServiceName } from './runtime-service-name'
import { parseSessionConfigOptions } from './session-config'

import type { RuntimeInstance } from './runtime-instances'

export const runtimeModelsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(500),
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
    }),
  )
  .max(500)
export type RuntimeModel = z.infer<typeof runtimeModelsSchema>[number]
const runtimeModelCatalogSchema = z.object({
  models: runtimeModelsSchema,
  controls: z
    .object({
      modelId: z.string().min(1).max(500),
      effort: z
        .array(z.object({ value: z.string().min(1).max(100), name: z.string().max(200) }))
        .max(100),
      fast: z.boolean(),
      defaultFast: z.enum(['on', 'off']).optional(),
    })
    .optional(),
  message: z.string().optional(),
})

export type RuntimeModelCatalog = z.infer<typeof runtimeModelCatalogSchema>

async function probeManagedModels(
  teamId: string,
  instance: RuntimeInstance,
  model?: string,
): Promise<RuntimeModelCatalog> {
  const namespace = config.claudeCodeRuntimeProvisioner.namespace
  const hosted = await runtimes().findOne({ _id: instance.id, teamId, hostedBy: 'nuphos' })
  const deployment = hosted && runtimeServiceName(hosted.url, namespace)

  if (!deployment) throw new Error('Runtime not ready')
  let output = ''

  await execRuntimeCommand(
    namespace,
    deployment,
    [
      'node',
      '--input-type=module',
      '-e',
      RUNTIME_MODEL_PROBE,
      instance.provider,
      ...(model ? [model] : []),
    ],
    (chunk) => {
      output += chunk
      if (output.length > 1024 * 1024) throw new Error('Invalid model catalog')
    },
    AbortSignal.timeout(30_000),
  )

  return runtimeModelCatalogSchema.parse(JSON.parse(output))
}

/** Read advertised choices without resuming, modifying, or claiming a live conversation. */
async function observedModels(
  teamId: string,
  instance: RuntimeInstance,
  selectedModel?: string,
): Promise<RuntimeModelCatalog> {
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, undefined, instance.provider)
  const development = developmentRuntimeEndpoint(instance.provider)

  if (development) endpoints.push(development)
  const endpoint = endpoints.find((candidate) => candidate.runtimeId === instance.id)

  if (!endpoint) return { models: [] }
  const sessions = await agentConversations()
    .find(
      {
        teamId,
        'claudeCodePreview.runtimeUrl': endpoint.url,
      },
      { projection: { claudeCodePreview: 1 } },
    )
    .sort({ lastActiveAt: -1 })
    .limit(5)
    .toArray()

  if (!sessions.length) return { models: [] }
  const client = await OpenAbAcpClient.connect({
    ...(await reachableRuntimeEndpoint(endpoint)),
    callTimeoutMs: 5_000,
  })

  try {
    await client.initialize()
    let observed: RuntimeModelCatalog = { models: [] }

    for (const session of sessions) {
      const id = session.claudeCodePreview?.openabSessionId

      if (!id) continue
      try {
        const result = await client.getSessionConfigOptions(id)
        const options = parseSessionConfigOptions(result.configOptions)
        const model = options.find((option) => option.kind === 'model')

        if (model?.options.length) {
          observed = runtimeModelCatalogSchema.parse({
            models: model.options.map((option) => ({
              id: option.value,
              name: option.name,
              description: option.description,
            })),
            ...(selectedModel && model.currentValue === selectedModel
              ? {
                  controls: {
                    modelId: selectedModel,
                    effort:
                      options
                        .find((o) => o.kind === 'effort')
                        ?.options.map(({ value, name }) => ({ value, name })) ?? [],
                    fast: ['on', 'off'].every((value) =>
                      options
                        .find((o) => o.kind === 'fast')
                        ?.options.some((o) => o.value === value),
                    ),
                  },
                }
              : {}),
          })
          if (observed.controls || !selectedModel) return observed
        }
      } catch {
        /* A dormant or busy session must not affect an active conversation. */
      }
    }

    return observed
  } finally {
    client.close()
  }
}

async function discoverModels(
  teamId: string,
  instance: RuntimeInstance,
  model?: string,
): Promise<RuntimeModelCatalog> {
  if (instance.kind === 'local') return localRuntimeModels(instance.id, model)
  if (instance.kind === 'managed') {
    try {
      const catalog = await probeManagedModels(teamId, instance, model)

      if (catalog.models.length) return catalog
    } catch {
      /* Older runtimes can still advertise choices through an active session. */
    }
  }
  const catalog = await observedModels(teamId, instance, model)

  return catalog.models.length
    ? {
        ...catalog,
        ...(!catalog.controls
          ? {
              message:
                'Select a model already used by an active conversation, then retry to load its effort and Fast options.',
            }
          : {}),
      }
    : {
        models: [],
        message:
          instance.kind === 'managed'
            ? 'Models are unavailable. Check that the runtime is online, then retry.'
            : 'Open a conversation with this runtime, send a message, then retry to load its models.',
      }
}

export const runtimeModelCatalog = createRuntimeModelCatalog({
  requireInstance: requireRuntimeInstance,
  discover: discoverModels,
  now: Date.now,
})
