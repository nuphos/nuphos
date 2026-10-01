import { z } from 'zod'

export type TunnelPurpose = 'transport' | 'control' | 'exec'

export const LOCAL_AGENT_PROVIDERS = ['claude-code', 'codex'] as const

export type LocalAgentProvider = (typeof LOCAL_AGENT_PROVIDERS)[number]

const modelControlsSchema = z.object({
  effort: z
    .array(z.object({ value: z.string().min(1).max(100), name: z.string().max(200) }))
    .max(100),
  fast: z.boolean(),
  defaultFast: z.enum(['on', 'off']).optional(),
})

/** What the computer's agent advertises before any conversation. */
export const localModelCatalogSchema = z.object({
  models: z
    .array(
      z.object({
        id: z.string().min(1).max(500),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
      }),
    )
    .max(200),
  defaultModel: z.string().min(1).max(500),
  controls: z.record(z.string().max(500), modelControlsSchema),
})

/** One agent the computer is running right now; absent from `agents` when it is not. */
const localAgentStatusSchema = z.object({
  cli: z.object({ installed: z.boolean(), loggedIn: z.boolean().nullable() }),
  version: z.string().max(200).optional(),
  models: localModelCatalogSchema.optional(),
})

export type LocalAgentStatus = z.infer<typeof localAgentStatusSchema>

export const localRuntimeStatusSchema = z.object({
  localExec: z.boolean().optional(),
  agents: z.object({
    'claude-code': localAgentStatusSchema.optional(),
    codex: localAgentStatusSchema.optional(),
  }),
  backendUrl: z.string().url().max(500).optional(),
})

export type LocalRuntimeStatus = z.infer<typeof localRuntimeStatusSchema>

const streamIdSchema = z.string().min(1).max(64)
// One ACP frame; openab caps a session/update well below this.
const payload = z.string().max(8 * 1024 * 1024)

/** Desktop → backend over the tunnel WebSocket. */
export const desktopFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('status'), status: localRuntimeStatusSchema }),
  z.object({ t: z.literal('opened'), s: streamIdSchema }),
  z.object({ t: z.literal('data'), s: streamIdSchema, d: payload }),
  z.object({
    t: z.literal('close'),
    s: streamIdSchema,
    code: z.number().int().optional(),
    reason: z.string().max(500).optional(),
  }),
  z.object({ t: z.literal('pong') }),
])

export type DesktopFrame = z.infer<typeof desktopFrameSchema>

/** Backend → desktop over the tunnel WebSocket. */
export type BackendFrame =
  | { t: 'open'; s: string; purpose: TunnelPurpose; provider?: LocalAgentProvider }
  | { t: 'data'; s: string; d: string }
  | { t: 'close'; s: string; reason?: string }
  | { t: 'ping' }

/** Any replica → the replica holding the device's tunnel. */
export type HolderMessage =
  | {
      t: 'open'
      s: string
      conn: string
      teamId: string
      purpose: TunnelPurpose
      provider?: LocalAgentProvider
    }
  | { t: 'data'; s: string; d: string }
  | { t: 'close'; s: string }
  | { t: 'supersede'; conn: string; previous?: string }
  | { t: 'ping'; conn: string }

/** The holder → the replica that opened one stream. */
export type StreamMessage =
  { t: 'opened' } | { t: 'data'; d: string } | { t: 'close'; code?: number; reason?: string }

export function holderChannel(userId: string, deviceId: string): string {
  return `agent:device:runtime:holder:${userId}:${deviceId}`
}

export function streamChannel(streamId: string): string {
  return `agent:device:runtime:stream:${streamId}`
}

export function parseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}
