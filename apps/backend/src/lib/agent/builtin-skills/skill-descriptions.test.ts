import { existsSync, readdirSync, readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'

const SKILLS = new URL('./skills/', import.meta.url)

// Claude Code lists every installed skill's description in each request, so every
// conversation pays for all of them on every model call. Say what the skill does and
// what should trigger it; the body carries the rest.
test('every built-in skill description fits in 100 characters', () => {
  const tooLong = readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => existsSync(new URL(`${entry.name}/SKILL.md`, SKILLS)))
    .flatMap((entry) => {
      const source = readFileSync(new URL(`${entry.name}/SKILL.md`, SKILLS), 'utf8')
      const frontMatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
      const { description } = parse(frontMatter) as { description: string }

      return description.length > 100 ? [`${entry.name} (${description.length})`] : []
    })

  expect(tooLong).toEqual([])
})
