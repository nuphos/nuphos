import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { mintRuntimeSkillsToken } from '@/lib/claude-code-preview/runtime-skills-token'
import { errorHandler } from '@/lib/errors'

import { claudeCodeRuntimeSkills } from './claude-code-runtime-skills'

const app = new Hono()

app.route('/skills', claudeCodeRuntimeSkills)
app.onError(errorHandler)

describe('Claude runtime skills route', () => {
  test('serves only the signed team and omits Claude Code reserved plan', async () => {
    const denied = await app.request('/skills/team-1', {
      headers: { Authorization: `Bearer ${mintRuntimeSkillsToken('team-2')}` },
    })

    expect(denied.status).toBe(401)

    const response = await app.request('/skills/team-1', {
      headers: { Authorization: `Bearer ${mintRuntimeSkillsToken('team-1')}` },
    })
    const bundle = (await response.json()) as {
      revision: string
      files: { path: string }[]
    }
    const paths = new Set(bundle.files.map((file) => file.path))

    expect(response.status).toBe(200)
    expect(bundle.revision).toHaveLength(64)
    expect(paths.has('nuphos-plan/SKILL.md')).toBe(true)
    expect(paths.has('architecture-diagram/SKILL.md')).toBe(true)
    expect(paths.has('nuphos-dashboards/SKILL.md')).toBe(true)
    expect(paths.has('plan/SKILL.md')).toBe(false)
  })

  test('a runtime already holding the bundle gets 304, not the body', async () => {
    const headers = { Authorization: `Bearer ${mintRuntimeSkillsToken('team-1')}` }
    const first = await app.request('/skills/team-1', { headers })
    const etag = first.headers.get('ETag') ?? ''
    const again = await app.request('/skills/team-1', {
      headers: { ...headers, 'If-None-Match': etag },
    })

    expect(etag).not.toBe('')
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
  })
})
