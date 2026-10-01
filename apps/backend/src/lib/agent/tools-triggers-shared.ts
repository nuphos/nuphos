import { z } from 'zod'

import { config } from '@/config'
import { stripTrailingSlashes } from '@/lib/agent/text-scan'
import { AppError } from '@/lib/errors'

/**
 * Where the current agent session originated. Gates trigger creation:
 * - 'user': an interactive conversation (desktop/web, Slack, Discord, MCP) —
 *   creation allowed after confirming with the user.
 * - 'trigger': a session fired BY a trigger — creation refused, otherwise a
 *   trigger whose message says "create a trigger" self-replicates on every
 *   fire.
 */
export type AgentSessionOrigin = 'user' | 'trigger'

export const label = z
  .string()
  .min(1)
  .max(160)
  .describe('Short human-readable description of this single action, shown to the user as a step.')

export const slackDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dm_self') }),
  z.object({
    type: z.literal('channel'),
    channelId: z.string().min(1).max(32),
  }),
])

export const monitoringIdentitySchema = z
  .object({
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/)
      .min(1)
      .max(64)
      .describe(
        'Stable normalized provider key. Use the built-in key when known, otherwise a lowercase key such as tencent-cloud.',
      ),
    integrationId: z.string().min(1).max(512),
    resourceId: z.string().min(1).max(512),
  })
  .strict()

export function webhookUrlFor(triggerId: string | undefined): string | undefined {
  if (!triggerId) return undefined
  // Prefer the public origin: NUPHOS_BACKEND_URL is the cluster-INTERNAL base
  // in production (it exists so sandboxes can call the backend), which external
  // webhook senders can't reach. auth.publicBaseUrl is the deploy's public
  // origin — but skip its localhost fallback (local dev with no
  // NUPHOS_AUTH_BASE_URL), where backendUrl (e.g. a dev tunnel) is the
  // reachable one.
  const publicBase = config.auth.publicBaseUrl
  const raw =
    publicBase && !/\/\/localhost[:/]/i.test(publicBase) ? publicBase : config.agent.backendUrl
  const base = raw ? stripTrailingSlashes(raw) : undefined

  return base ? `${base}/webhooks/${triggerId}` : `/webhooks/${triggerId}`
}

export function groupWebhookUrl(
  triggerId: string | undefined,
  partitionKey: string,
): string | undefined {
  const base = webhookUrlFor(triggerId)

  if (!base) return undefined
  const separator = base.includes('?') ? '&' : '?'

  return `${base}${separator}source=${encodeURIComponent(partitionKey)}`
}

export function chunkGroupMembers(memberKeys: string[], size = 10): string[][] {
  const chunks: string[][] = []

  for (let index = 0; index < memberKeys.length; index += size) {
    chunks.push(memberKeys.slice(index, index + size))
  }

  return chunks
}

/** Tool results are data for the model — surface AppErrors as structured failures, not thrown stack traces. */
export async function run<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: `${err.code}: ${err.message}` }
    throw err
  }
}

export type TriggerToolScope = {
  userId: string
  teamId: string | undefined
  sessionId: string
}
