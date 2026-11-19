import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { fastChoicesSchema } from '@/lib/agent/devices/local-runtime/protocol'

import { controlRegistry } from './agent-chat-registry'
import { OpenAbAcpClient } from './openab-acp-client'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { resolveDefaultModel } from './runtime-default-model'
import { localRuntimeModels } from './local-runtime-catalog'
import { createRuntimeModelCatalog } from './runtime-model-cache'
import { RUNTIME_MODEL_PROBE } from './runtime-model-probe'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { parseSessionConfigOptions } from './session-config-options'

import type { RuntimeInstance } from './runtime-instances'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'

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
      // The model these controls were read for; absent when the runtime lists no
      // models and its settings therefore belong to the session, not a model.
      modelId: z.string().min(1).max(500).optional(),
      effort: z
        .array(
          z.object({
            value: z.string().min(1).max(100),
            name: z.string().max(200),
            description: z.string().max(200).optional(),
          }),
        )
        .max(100),
      fast: fastChoicesSchema,
      defaultFast: z.string().max(100).optional(),
      defaultEffort: z.string().max(100).optional(),
    })
    .optional(),
  message: z.string().optional(),
})

export type RuntimeModelCatalog = z.infer<typeof runtimeModelCatalogSchema>

/** The control endpoint the agent answers on, or none while it is offline. */
async function controlEndpoint(teamId: string, instance: RuntimeInstance) {
  return instance.kind === 'development'
    ? developmentRuntimeEndpoint(instance.provider, 'control')
    : (await resolveTeamRuntimeEndpoints(teamId, instance.provider, 'control')).find(
        (candidate) => candidate.runtimeId === instance.id,
      )
}

async function probeConnectedModels(
  teamId: string,
  instance: RuntimeInstance,
  endpoint: TeamRuntimeEndpoint | undefined,
  model?: string,
): Promise<RuntimeModelCatalog> {
  if (!endpoint) throw new Error('Runtime offline')
  const client = await controlRegistry.acquire(teamId, endpoint)

  if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel'))
    throw new Error('Runtime model discovery requires a newer image')
  const result = await client.runJob(
    {
      jobId: randomUUID(),
      job: 'panel',
      stdin: JSON.stringify({
        runner: RUNTIME_MODEL_PROBE,
        script: '',
        params: { provider: instance.provider, model },
      }),
      env: {},
      timeoutMs: 30_000,
      maxStdoutBytes: 1024 * 1024,
    },
    35_000,
  )

  if (result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string')
    throw new Error('Model discovery failed')

  return runtimeModelCatalogSchema.parse(JSON.parse(result.stdout))
}

/** Ask the runtime what a new session of its agent offers; no conversation is involved. */
async function observedModels(
  teamId: string,
  instance: RuntimeInstance,
  selectedModel?: string,
): Promise<RuntimeModelCatalog> {
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, instance.provider)
  const development = developmentRuntimeEndpoint(instance.provider)

  if (development) endpoints.push(development)
  const endpoint = endpoints.find((candidate) => candidate.runtimeId === instance.id)

  if (!endpoint) return { models: [] }
  const client = await OpenAbAcpClient.connect({ ...endpoint, callTimeoutMs: 5_000 })

  try {
    await client.initialize()
    const result = await client.getAgentConfigOptions(selectedModel)
    const options = parseSessionConfigOptions(result.configOptions)
    const model = options.find((option) => option.kind === 'model')
    const effort = options.find((option) => option.kind === 'effort')
    const speeds = options.find((option) => option.kind === 'fast')

    if (!model?.options.length) return { models: [] }

    return runtimeModelCatalogSchema.parse({
      models: model.options.map((option) => ({
        id: option.value,
        name: option.name,
        description: option.description,
      })),
      controls: {
        modelId: model.currentValue,
        defaultEffort: effort?.currentValue,
        defaultFast: speeds?.currentValue,
        effort:
          effort?.options.map(({ value, name, description }) => ({
            value,
            name,
            ...(description ? { description } : {}),
          })) ?? [],
        fast: speeds?.options.some((o) => o.value === 'off')
          ? speeds.options.map(({ value, name }) => ({ value, name }))
          : [],
      },
    })
  } finally {
    client.close()
  }
}

export async function discoverModels(
  teamId: string,
  instance: RuntimeInstance,
  model?: string,
): Promise<RuntimeModelCatalog> {
  if (instance.kind === 'local') return localRuntimeModels(instance.id, model)
  const endpoint = await controlEndpoint(teamId, instance)

  try {
    const catalog = await probeConnectedModels(teamId, instance, endpoint, model)

    if (catalog.models.length) return catalog
  } catch {
    // An older image without the probe still runs its agent through OpenAB.
  }
  // Runtimes older than the agent probe answer it with an error: they need an update.
  const catalog = await observedModels(teamId, instance, model).catch(() => null)

  return catalog?.models.length
    ? catalog
    : {
        models: [],
        message:
          instance.kind === 'managed'
            ? 'Models are unavailable. Check that the runtime is online, then retry.'
            : 'Could not discover models. Check the agent’s sign-in and update its runtime, then retry.',
      }
}

/**
 * A runtime whose models this person may read. The models of a teammate's shared
 * computer come from its own report (localRuntimeModels), so nothing runs there,
 * and its agents are offered wherever a conversation can be placed on it.
 */
export function requireModelRuntimeInstance(
  teamId: string,
  runtimeId: string,
  userId?: string,
  require: typeof requireRuntimeInstance = requireRuntimeInstance,
): Promise<RuntimeInstance> {
  return require(teamId, runtimeId, userId)
}

export const runtimeModelCatalog = createRuntimeModelCatalog({
  requireInstance: requireModelRuntimeInstance,
  discover: async (teamId, instance, model) =>
    resolveDefaultModel(await discoverModels(teamId, instance, model)),
})
