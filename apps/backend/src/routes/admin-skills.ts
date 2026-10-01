import { Hono } from 'hono'
import { z } from 'zod'

import { normalizeSkillScope } from '@/lib/agent/skill-store/scope'
import {
  deleteSkillByName,
  deleteSkillObject,
  getSkillManifest,
  getSkillMetadata,
  getSkillMutationHistory,
  getSkillObject,
  listSkillObjects,
  listSkillScopes,
  MAX_SKILL_UPLOAD_BYTES,
  putSkillObject,
} from '@/lib/agent/skill-store/service'
import { skillUploadBodyLimit } from '@/lib/agent/skill-store/upload-body-limit'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

type AdminSkillsVariables = {
  adminUserId?: string
  requestId?: string
}

export const adminSkillsRoutes = new Hono<{ Variables: AdminSkillsVariables }>()

const scopeQuerySchema = z.object({
  scope: z.string().trim().min(1),
})

const objectKeyQuerySchema = scopeQuerySchema.extend({
  key: z.string().trim().min(1),
})

const skillNameQuerySchema = scopeQuerySchema.extend({
  name: z.string().trim().min(1),
})

const skillHistoryQuerySchema = skillNameQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(250).default(100),
})

function resolveScope(scope: string): string {
  return normalizeSkillScope(scope)
}

function mutationContext(c: { get: (key: 'adminUserId' | 'requestId') => string | undefined }) {
  const requestId = c.get('requestId')

  return {
    mutationId: requestId,
    actor: {
      userId: c.get('adminUserId') ?? null,
      source: 'admin' as const,
      requestId,
    },
  }
}

adminSkillsRoutes.get('/scopes', async (c) => {
  const scopes = await listSkillScopes()

  return c.json({ scopes })
})

adminSkillsRoutes.get('/manifest', zv('query', scopeQuerySchema), async (c) => {
  const { scope } = c.req.valid('query')
  const manifest = await getSkillManifest(resolveScope(scope))

  return c.json(manifest)
})

adminSkillsRoutes.get('/objects', zv('query', scopeQuerySchema), async (c) => {
  const { scope } = c.req.valid('query')
  const listing = await listSkillObjects(resolveScope(scope))

  return c.json(listing)
})

adminSkillsRoutes.get('/object', zv('query', objectKeyQuerySchema), async (c) => {
  const { scope, key } = c.req.valid('query')
  const detail = await getSkillObject(resolveScope(scope), key)

  return c.json(detail)
})

adminSkillsRoutes.get('/history', zv('query', skillHistoryQuerySchema), async (c) => {
  const { scope: rawScope, name, limit } = c.req.valid('query')
  const scope = resolveScope(rawScope)
  const [metadata, events] = await Promise.all([
    getSkillMetadata(scope, name),
    getSkillMutationHistory(scope, name, limit),
  ])

  return c.json({ scope, name, metadata, events })
})

adminSkillsRoutes.post('/object', skillUploadBodyLimit, async (c) => {
  const body = await c.req.parseBody()
  const scopeField = body.scope
  const keyField = body.key
  const fileField = body.file

  if (typeof scopeField !== 'string' || !scopeField.trim()) {
    throw new AppError(400, 'invalid_input', 'scope is required')
  }
  if (typeof keyField !== 'string' || !keyField.trim()) {
    throw new AppError(400, 'invalid_input', 'key is required')
  }
  if (!(fileField instanceof File)) {
    throw new AppError(400, 'invalid_input', 'file is required')
  }
  if (fileField.size > MAX_SKILL_UPLOAD_BYTES) {
    throw new AppError(
      413,
      'skill_upload_too_large',
      `Upload exceeds ${String(MAX_SKILL_UPLOAD_BYTES)} bytes`,
    )
  }

  const bytes = Buffer.from(await fileField.arrayBuffer())
  const saved = await putSkillObject(
    resolveScope(scopeField),
    keyField,
    bytes,
    fileField.type || null,
    mutationContext(c),
  )

  return c.json(saved, 201)
})

adminSkillsRoutes.delete('/object', zv('query', objectKeyQuerySchema), async (c) => {
  const { scope, key } = c.req.valid('query')

  await deleteSkillObject(resolveScope(scope), key, mutationContext(c))

  return c.body(null, 204)
})

adminSkillsRoutes.delete('/skill', zv('query', skillNameQuerySchema), async (c) => {
  const { scope, name } = c.req.valid('query')
  const result = await deleteSkillByName(resolveScope(scope), name, mutationContext(c))

  return c.json(result)
})
