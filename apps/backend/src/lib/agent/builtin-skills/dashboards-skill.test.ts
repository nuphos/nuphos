import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '../skill-store/inject'

describe('builtin skills: nuphos-dashboards visibility (#2988)', () => {
  test('an agent creates a personal dashboard unless the user asks for a team one', async () => {
    const skill = await fs.readFile(
      path.join(getBuiltinSkillsDirectory(), 'nuphos-dashboards', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain("visibility: 'personal'\\|'team'")
    expect(skill).toContain(
      "Always send `visibility` when creating a dashboard: `'personal'` (only its creator sees it) unless the user asks for a team dashboard",
    )
  })
})
