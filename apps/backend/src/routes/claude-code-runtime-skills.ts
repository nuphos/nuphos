import { Hono } from 'hono'

import { nativeSkillBundle, personalSkillBundle } from '@/lib/claude-code-preview/native-skills'
import type { SkillBundle } from '@/lib/claude-code-preview/native-skills'
import { verifyRuntimeSkillsToken } from '@/lib/claude-code-preview/runtime-skills-token'
import { AppError } from '@/lib/errors'

export const claudeCodeRuntimeSkills = new Hono()

function skillBundle(teamId: string, personal: boolean, userId?: string): Promise<SkillBundle> {
  if (!personal) return nativeSkillBundle(teamId)
  // Automation actors are not members and have no personal scope.
  if (!userId || !/^[a-f0-9]{24}$/u.test(userId)) {
    const none = { revision: 'none', files: [] }

    return Promise.resolve({ revision: none.revision, read: () => Promise.resolve(none) })
  }

  return personalSkillBundle(teamId, userId)
}

claudeCodeRuntimeSkills.get('/:teamId', async (c) => {
  const authorization = c.req.header('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  const teamId = c.req.param('teamId')

  const claims = verifyRuntimeSkillsToken(token)

  if (claims?.teamId !== teamId) {
    throw new AppError(401, 'unauthorized', 'Invalid runtime skills credential')
  }
  // `?scope=personal` is the personal skills of the member the credential
  // names. `scope` in the body lets a runtime tell this answer from the team
  // bundle an older backend would send for the same request.
  const personal = c.req.query('scope') === 'personal'
  const bundle = await skillBundle(teamId, personal, claims.userId)

  c.header('Cache-Control', 'no-store')
  // A runtime that re-syncs per session already holds the bundle almost every
  // time. Let it say so and skip reading the bundle at all.
  if (c.req.header('If-None-Match') === `"${bundle.revision}"`) {
    c.header('ETag', `"${bundle.revision}"`)

    return c.body(null, 304)
  }
  const body = await bundle.read()

  c.header('ETag', `"${body.revision}"`)

  return c.json(personal ? { scope: 'personal', ...body } : body)
})
