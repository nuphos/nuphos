import { describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import * as inject from '@/lib/agent/skill-store/inject'
import * as skillsS3 from '@/lib/agent/skill-store/skills-s3'
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

  test('a held bundle is confirmed without reading a skill file', async () => {
    const headers = { Authorization: `Bearer ${mintRuntimeSkillsToken('team-1')}` }
    const etag = (await app.request('/skills/team-1', { headers })).headers.get('ETag') ?? ''
    const reads = spyOn(inject, 'collectSkillFiles')

    try {
      const held = await app.request('/skills/team-1', {
        headers: { ...headers, 'If-None-Match': etag },
      })

      expect(held.status).toBe(304)
      expect(reads).not.toHaveBeenCalled()

      const stale = await app.request('/skills/team-1', {
        headers: { ...headers, 'If-None-Match': '"older"' },
      })

      expect(stale.status).toBe(200)
      expect(stale.headers.get('ETag')).toBe(etag)
      expect(((await stale.json()) as { revision: string }).revision).toBe(etag.slice(1, -1))
    } finally {
      reads.mockRestore()
    }
  })

  test('a pod that just synced the team confirms the bundle it served without reading it again', async () => {
    // A cold pod: nothing of this team is cached, so the first request syncs it from the store.
    const teamId = `team-cold-${String(Date.now())}`
    const store = {
      listUnderPrefix: (prefix: string) =>
        Promise.resolve(
          prefix.startsWith('teams/')
            ? [{ key: `${prefix}cold/SKILL.md`, etag: 'e1', size: 7, lastModified: new Date(0) }]
            : [],
        ),
      getObjectBody: () => Promise.resolve(Buffer.from('# cold\n')),
    } as unknown as skillsS3.SkillsS3Client
    const spies = [
      spyOn(skillsS3, 'isSkillsS3Configured').mockReturnValue(true),
      spyOn(skillsS3, 'getSkillsStore').mockReturnValue(store),
    ]
    const headers = { Authorization: `Bearer ${mintRuntimeSkillsToken(teamId)}` }

    try {
      const first = await app.request(`/skills/${teamId}`, { headers })
      const etag = first.headers.get('ETag') ?? ''
      const paths = ((await first.json()) as { files: { path: string }[] }).files.map((f) => f.path)

      expect(paths).toContain('cold/SKILL.md')
      const reads = spyOn(inject, 'collectSkillFiles')

      try {
        const held = await app.request(`/skills/${teamId}`, {
          headers: { ...headers, 'If-None-Match': etag },
        })

        expect(held.status).toBe(304)
        expect(reads).not.toHaveBeenCalled()
      } finally {
        reads.mockRestore()
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  test('personal scope answers only for the member the credential names', async () => {
    const userId = '64f1a2b3c4d5e6f7a8b9c0d2'
    const personal = await app.request('/skills/team-1?scope=personal', {
      headers: { Authorization: `Bearer ${mintRuntimeSkillsToken('team-1', userId)}` },
    })
    const anonymous = await app.request('/skills/team-1?scope=personal', {
      headers: { Authorization: `Bearer ${mintRuntimeSkillsToken('team-1')}` },
    })

    // No store in the suite, so the member simply has none: never the team bundle.
    expect(await personal.json()).toMatchObject({ scope: 'personal', files: [] })
    expect(await anonymous.json()).toEqual({ scope: 'personal', revision: 'none', files: [] })
  })
})
