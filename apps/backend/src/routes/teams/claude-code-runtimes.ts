// Team-bound OpenAB runtime registry: members see what runtimes the team can
// run on, administrators register/disable/remove them. The provisioner writes
// through the same lib; these routes are the manual/ops surface.
import { z } from 'zod'

import {
  isAllowedRemoteOpenAbUrl,
  isInternalRuntimeUrl,
  requirePublicBackendUrl,
} from '@/lib/claude-code-preview/runtime-backend-url'
import { pairTeamRuntime } from '@/lib/claude-code-preview/runtime-pairing'
import { PAIRING_CODE_PATTERN } from '@/lib/claude-code-preview/runtime-pairing-client'
import { OPENAB_PROVIDERS } from '@/lib/claude-code-preview/runtime-provider'
import { probeExternalRuntimeProvider } from '@/lib/claude-code-preview/runtime-provider-probe'
import {
  listTeamRuntimes,
  registerTeamRuntime,
  removeTeamRuntime,
  setTeamRuntimeStatus,
} from '@/lib/claude-code-preview/runtime-registry'
import { rotateRuntimeKeys } from '@/lib/claude-code-preview/runtime-registry-credentials'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

// The length floor is checked in the handler, not the schema: a schema failure reaches
// the app only as "Invalid input", and this is the one field an operator mistypes.
const runtimeKeySchema = z.string().trim().min(1).max(500)
const MIN_RUNTIME_PASSWORD = 32

export const registerRuntimeSchema = z
  .object({
    url: z.string().trim().min(6).max(500),
    authKey: runtimeKeySchema,
    controlKey: runtimeKeySchema.optional(),
    label: z.string().trim().max(120).optional(),
  })
  .strict()

export const registerExternalRuntimeSchema = registerRuntimeSchema.extend({
  provider: z.enum(OPENAB_PROVIDERS).optional(),
})

export const pairRuntimeSchema = z
  .object({
    url: z.string().trim().min(6).max(500),
    code: z.string().trim().toUpperCase().regex(PAIRING_CODE_PATTERN, 'Invalid pairing code'),
    label: z.string().trim().max(120).optional(),
    replaceRuntimeId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

export const rotateRuntimeKeysSchema = z
  .object({ authKey: runtimeKeySchema, controlKey: runtimeKeySchema.optional() })
  .strict()

/** Everything between the internet and an agent holding the team's cloud credentials. */
export function assertRuntimePasswordLength(authKey: string, controlKey?: string): void {
  if (authKey.length < MIN_RUNTIME_PASSWORD)
    throw new AppError(
      422,
      'runtime_password_too_short',
      `The admin password must be at least ${String(MIN_RUNTIME_PASSWORD)} characters; this one is ${String(authKey.length)}. \`openssl rand -hex 32\` makes one that fits.`,
    )
  if (controlKey !== undefined && controlKey.length < MIN_RUNTIME_PASSWORD)
    throw new AppError(
      422,
      'runtime_password_too_short',
      `The operator key must be at least ${String(MIN_RUNTIME_PASSWORD)} characters; this one is ${String(controlKey.length)}.`,
    )
}

export function defaultExternalRuntimeLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.slice(0, 120) || undefined
  } catch {
    return undefined
  }
}

async function registerExternalRuntime(
  c: Context<{ Variables: TeamAuthVariables }>,
  provider: OpenAbProvider,
  body: z.infer<typeof registerRuntimeSchema>,
) {
  // A runtime outside the cluster reaches this backend over the public
  // internet for every Nuphos tool call and for its skill bundle. Refuse
  // rather than hand it an address it cannot resolve and let the agent
  // fail tool by tool. An in-cluster `ws://*.svc` runtime needs none of it.
  if (!isInternalRuntimeUrl(body.url)) requirePublicBackendUrl()
  const label = body.label || defaultExternalRuntimeLabel(body.url)
  const runtime = await registerTeamRuntime({
    teamId: c.get('teamId'),
    userId: c.get('userId'),
    url: body.url,
    provider,
    authKey: body.authKey,
    ...(body.controlKey ? { controlKey: body.controlKey } : {}),
    ...(label ? { label } : {}),
  })

  return c.json(runtime, 201)
}

export function registerExternalRuntimeRoute(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.post(
    '/agent-runtimes/external',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', registerExternalRuntimeSchema),
    async (c) => {
      const { provider: requested, ...body } = c.req.valid('json')

      assertRuntimePasswordLength(body.authKey, body.controlKey)
      if (!isAllowedRemoteOpenAbUrl(body.url))
        throw new AppError(
          422,
          'invalid_runtime_url',
          'Agent URL must be wss://, or ws:// on a *.svc cluster-internal host.',
        )
      const provider = requested ?? (await probeExternalRuntimeProvider(body.url, body.authKey))

      if (!provider)
        throw new AppError(
          422,
          'runtime_provider_undetected',
          'Nuphos could not reach this agent or tell whether it runs Claude Code or Codex. Check the address and admin password, and that the agent image is up to date.',
        )

      return registerExternalRuntime(c, provider, body)
    },
  )
  teamScoped.post(
    '/agent-runtimes/pair',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', pairRuntimeSchema),
    async (c) => {
      const body = c.req.valid('json')
      const runtime = await pairTeamRuntime({
        teamId: c.get('teamId'),
        userId: c.get('userId'),
        url: body.url,
        code: body.code,
        ...(body.label ? { label: body.label } : {}),
        ...(body.replaceRuntimeId ? { replaceRuntimeId: body.replaceRuntimeId } : {}),
      })

      return c.json(runtime, runtime.replaced ? 200 : 201)
    },
  )
}

const runtimeStatusSchema = z.object({ status: z.enum(['active', 'disabled']) }).strict()

export function registerClaudeCodeRuntimeRoutes(
  teamScoped: Hono<{ Variables: TeamAuthVariables }>,
  provider: OpenAbProvider = 'claude-code',
) {
  const path = provider === 'codex' ? '/codex-runtimes' : '/claude-code-runtimes'
  const assertProvider = async (teamId: string, id: string) => {
    const runtime = (await listTeamRuntimes(teamId, provider)).find((runtime) => runtime.id === id)

    if (!runtime) throw new AppError(404, 'runtime_not_found', 'Agent not found')
    if (runtime.hostedBy)
      throw new AppError(
        409,
        'managed_runtime',
        'Manage this agent in Settings → Agent or /agent-runtimes instead',
      )

    return runtime
  }

  teamScoped.get(path, async (c) => {
    return c.json({ runtimes: await listTeamRuntimes(c.get('teamId'), provider) })
  })

  teamScoped.post(
    path,
    requireTeamRole('ADMINISTRATOR'),
    zv('json', registerRuntimeSchema),
    async (c) => {
      const body = c.req.valid('json')

      assertRuntimePasswordLength(body.authKey, body.controlKey)

      return registerExternalRuntime(c, provider, body)
    },
  )

  teamScoped.patch(
    `${path}/:runtimeId`,
    requireTeamRole('ADMINISTRATOR'),
    zv('json', runtimeStatusSchema),
    async (c) => {
      await assertProvider(c.get('teamId'), c.req.param('runtimeId'))
      const updated = await setTeamRuntimeStatus(
        c.get('teamId'),
        c.req.param('runtimeId'),
        c.req.valid('json').status,
      )

      if (!updated) throw new AppError(404, 'runtime_not_found', 'Agent not found')

      return c.json(updated)
    },
  )

  teamScoped.put(
    `${path}/:runtimeId/keys`,
    requireTeamRole('ADMINISTRATOR'),
    zv('json', rotateRuntimeKeysSchema),
    async (c) => {
      const runtime = await assertProvider(c.get('teamId'), c.req.param('runtimeId'))
      const body = c.req.valid('json')

      assertRuntimePasswordLength(body.authKey, body.controlKey)
      const rotated = await rotateRuntimeKeys(c.get('teamId'), runtime.id, {
        authKey: body.authKey,
        ...(body.controlKey ? { controlKey: body.controlKey } : {}),
      })

      if (!rotated) throw new AppError(404, 'runtime_not_found', 'Agent not found')

      return c.json(runtime)
    },
  )

  teamScoped.delete(`${path}/:runtimeId`, requireTeamRole('ADMINISTRATOR'), async (c) => {
    await assertProvider(c.get('teamId'), c.req.param('runtimeId'))
    const removed = await removeTeamRuntime(c.get('teamId'), c.req.param('runtimeId'))

    if (!removed) throw new AppError(404, 'runtime_not_found', 'Agent not found')

    return c.body(null, 204)
  })
}
