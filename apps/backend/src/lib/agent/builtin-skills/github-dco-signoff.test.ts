import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

// #4561: with a member's Personal Credential the commit author is that member,
// so "never sign off for the participant" made agents ask them before every
// DCO commit, or skip the line.
test('the github skill lets the author sign off without asking', () => {
  const skill = readFileSync(join(import.meta.dir, 'skills/github/SKILL.md'), 'utf8')

  expect(skill).not.toContain('Never sign off for the participant')
  expect(skill).toContain('add it without asking')
  expect(skill).toContain('copied verbatim from `commit-signoff.sh`')
})
