import { existsSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { hiddenSkills } from './hidden-skills'

const SKILLS = new URL('../agent/builtin-skills/skills/', import.meta.url)

test('a provider skill is listed only once the conversation selects its provider', () => {
  const none = hiddenSkills([])

  expect(none).toContain('aws')
  expect(none).toContain('google-workspace')
  // Not tied to one credential: always listed.
  expect(none).not.toContain('github')
  expect(none).not.toContain('kubectl')

  const some = hiddenSkills([
    { provider: 'aws', id: 'role' },
    { provider: 'personal', id: 'gmail' },
  ])

  expect(some).not.toContain('aws')
  expect(some).not.toContain('aws-ec2-ssh')
  expect(some).not.toContain('google-workspace')
  expect(some).toContain('gcloud')
})

// A renamed skill would otherwise stay listed for everyone without anyone noticing.
test('every hidden skill is a built-in skill', () => {
  for (const skill of hiddenSkills([]))
    expect(existsSync(new URL(`${skill}/SKILL.md`, SKILLS))).toBe(true)
})
