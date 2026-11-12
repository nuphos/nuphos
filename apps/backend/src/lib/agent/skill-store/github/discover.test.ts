import { describe, expect, test } from 'bun:test'

import { discoverSkills, FRONTMATTER_BYTES } from './discover'

const skill = (name: string, description = `${name} skill`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`

function files(entries: Record<string, string>) {
  return new Map(
    Object.entries(entries).map(([path, content]) => [path, new TextEncoder().encode(content)]),
  )
}

describe('discoverSkills', () => {
  test('finds skills in the conventional folders, first name wins', () => {
    const found = discoverSkills(
      files({
        'skills/pdf/SKILL.md': skill('pdf'),
        'skills/pdf/scripts/run.py': 'print(1)',
        'skills/.curated/docx/SKILL.md': skill('docx'),
        '.claude/skills/pdf/SKILL.md': skill('pdf', 'duplicate'),
        'node_modules/x/skills/y/SKILL.md': skill('y'),
      }),
      null,
    )

    expect(found.map((s) => [s.name, s.path, s.description])).toEqual([
      ['docx', 'skills/.curated/docx', 'docx skill'],
      ['pdf', 'skills/pdf', 'pdf skill'],
    ])
    expect([...found[1]!.files.keys()]).toEqual(['SKILL.md', 'scripts/run.py'])
  })

  test('a subpath that is a skill returns only that skill', () => {
    const found = discoverSkills(
      files({ 'skills/pdf/SKILL.md': skill('pdf'), 'skills/docx/SKILL.md': skill('docx') }),
      'skills/docx',
    )

    expect(found.map((s) => s.name)).toEqual(['docx'])
  })

  test('reads frontmatter only from the start of SKILL.md', () => {
    const padded = `${skill('big')}${'x'.repeat(FRONTMATTER_BYTES)}`
    const late = `${'\n'.repeat(FRONTMATTER_BYTES)}${skill('late')}`
    const unclosed = `---\nname: open\ndescription: ${'y'.repeat(FRONTMATTER_BYTES)}\n---\n`
    const found = discoverSkills(
      files({
        'skills/big/SKILL.md': padded,
        'skills/late/SKILL.md': late,
        'skills/open/SKILL.md': unclosed,
      }),
      null,
    )

    expect(found.map((s) => [s.name, s.malformed])).toEqual([
      ['big', false],
      ['late', true],
      ['open', true],
    ])
  })

  test('falls back to a deep search and flags SKILL.md without frontmatter', () => {
    const found = discoverSkills(
      files({
        'tools/a/b/deep/SKILL.md': skill('deep'),
        'tools/plain/SKILL.md': '# no frontmatter',
      }),
      null,
    )

    expect(found.map((s) => [s.name, s.malformed])).toEqual([
      ['deep', false],
      ['plain', true],
    ])
  })
})
