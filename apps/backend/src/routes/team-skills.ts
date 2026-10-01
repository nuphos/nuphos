import { Hono } from 'hono'
import { z } from 'zod'

import {
  deleteSkillByName,
  deleteSkillObject,
  getSkillManifest,
  getSkillMetadata,
  getSkillMutationHistory,
  getSkillObject,
  listSkillObjects,
  MAX_SKILL_UPLOAD_BYTES,
  putSkillObject,
  teamSkillsScope,
} from '@/lib/agent/skill-store/service'
import { skillUploadBodyLimit } from '@/lib/agent/skill-store/upload-body-limit'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'

type TeamSkillsVariables = TeamAuthVariables & { requestId?: string }

export const teamSkillsRoutes = new Hono<{ Variables: TeamSkillsVariables }>()

const objectKeyQuerySchema = z.object({
  key: z.string().trim().min(1),
})

const skillNameQuerySchema = z.object({
  name: z.string().trim().min(1),
})

const skillHistoryQuerySchema = skillNameQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(250).default(100),
})

function resolveTeamScope(c: { get: (key: 'teamId') => string }): string {
  const teamId = parseObjectId(c.get('teamId'), 'teamId').toHexString()

  return teamSkillsScope(teamId)
}

function mutationContext(c: {
  get: {
    (key: 'userId'): string
    (key: 'requestId'): string | undefined
  }
}) {
  const requestId = c.get('requestId')

  return {
    mutationId: requestId,
    actor: {
      userId: c.get('userId'),
      source: 'desktop' as const,
      requestId,
    },
  }
}

teamSkillsRoutes.get('/manifest', async (c) => {
  const manifest = await getSkillManifest(resolveTeamScope(c))

  return c.json(manifest)
})

teamSkillsRoutes.get('/objects', async (c) => {
  const listing = await listSkillObjects(resolveTeamScope(c))

  return c.json(listing)
})

teamSkillsRoutes.get('/object', zv('query', objectKeyQuerySchema), async (c) => {
  const { key } = c.req.valid('query')
  const detail = await getSkillObject(resolveTeamScope(c), key)

  return c.json(detail)
})

teamSkillsRoutes.get('/history', zv('query', skillHistoryQuerySchema), async (c) => {
  const { name, limit } = c.req.valid('query')
  const scope = resolveTeamScope(c)
  const [metadata, events] = await Promise.all([
    getSkillMetadata(scope, name),
    getSkillMutationHistory(scope, name, limit),
  ])

  return c.json({ scope, name, metadata, events })
})

teamSkillsRoutes.post(
  '/object',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  skillUploadBodyLimit,
  async (c) => {
    const body = await c.req.parseBody()
    const keyField = body.key
    const fileField = body.file

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
      resolveTeamScope(c),
      keyField,
      bytes,
      fileField.type || null,
      mutationContext(c),
    )

    return c.json(saved, 201)
  },
)

teamSkillsRoutes.delete(
  '/object',
  requireTeamRole('ADMINISTRATOR'),
  zv('query', objectKeyQuerySchema),
  async (c) => {
    const { key } = c.req.valid('query')

    await deleteSkillObject(resolveTeamScope(c), key, mutationContext(c))

    return c.body(null, 204)
  },
)

teamSkillsRoutes.delete(
  '/skill',
  requireTeamRole('ADMINISTRATOR'),
  zv('query', skillNameQuerySchema),
  async (c) => {
    const { name } = c.req.valid('query')
    const result = await deleteSkillByName(resolveTeamScope(c), name, mutationContext(c))

    return c.json(result)
  },
)
