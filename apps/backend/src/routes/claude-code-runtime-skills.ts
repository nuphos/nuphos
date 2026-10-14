import { Hono } from 'hono'

import { nativeSkillBundle, personalSkillBundle } from '@/lib/claude-code-preview/native-skills'
import { verifyRuntimeSkillsToken } from '@/lib/claude-code-preview/runtime-skills-token'
import { AppError } from '@/lib/errors'

export const claudeCodeRuntimeSkills = new Hono()

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
  const bundle = !personal
    ? await nativeSkillBundle(teamId)
    : {
        scope: 'personal',
        // Automation actors are not members and have no personal scope.
        ...(claims.userId && /^[a-f0-9]{24}$/u.test(claims.userId)
          ? await personalSkillBundle(teamId, claims.userId)
          : { revision: 'none', files: [] }),
      }
  const etag = `"${bundle.revision}"`

  c.header('Cache-Control', 'no-store')
  c.header('ETag', etag)
  // A runtime that re-syncs per session already holds the bundle almost every
  // time. Let it say so and skip the body.
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304)

  return c.json(bundle)
})
