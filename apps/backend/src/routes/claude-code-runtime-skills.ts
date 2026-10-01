import { Hono } from 'hono'

import { nativeSkillBundle } from '@/lib/claude-code-preview/native-skills'
import { verifyRuntimeSkillsToken } from '@/lib/claude-code-preview/runtime-skills-token'
import { AppError } from '@/lib/errors'

export const claudeCodeRuntimeSkills = new Hono()

claudeCodeRuntimeSkills.get('/:teamId', async (c) => {
  const authorization = c.req.header('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  const teamId = c.req.param('teamId')

  if (verifyRuntimeSkillsToken(token) !== teamId) {
    throw new AppError(401, 'unauthorized', 'Invalid runtime skills credential')
  }
  const bundle = await nativeSkillBundle(teamId)
  const etag = `"${bundle.revision}"`

  c.header('Cache-Control', 'no-store')
  c.header('ETag', etag)
  // A runtime that re-syncs per session already holds the bundle almost every
  // time. Let it say so and skip the body.
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304)

  return c.json(bundle)
})
