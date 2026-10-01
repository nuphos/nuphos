import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

import { collectSkillFiles, getBuiltinSkillsDirectory } from '../skill-store/inject'

const GH_PR_CREATE = /(^|[|&;(]\s*)gh\s+pr\s+create\b/
const DRAFT_FLAG = /(^|\s)--draft(\s|=|$)/

describe('builtin skills: PR creation default', () => {
  test('no shipped skill hands the agent a `gh pr create --draft` recipe', async () => {
    const files = await collectSkillFiles(getBuiltinSkillsDirectory())
    const offenders: string[] = []

    for (const file of files) {
      if (path.posix.extname(file.relPath) !== '.md') continue
      for (const line of file.content.toString('utf8').split('\n')) {
        const command = line.trim()
        if (!GH_PR_CREATE.test(command) || !DRAFT_FLAG.test(command)) continue
        offenders.push(`${file.relPath}: ${command}`)
      }
    }

    expect(offenders).toEqual([])
  })

  test('the github skill still documents draft as an available exception', async () => {
    const skill = await fs.readFile(
      path.join(getBuiltinSkillsDirectory(), 'github', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('--draft')
  })
})
