import { describe, expect, test } from 'bun:test'

import {
  assertSkillNameNotBuiltinOverlay,
  buildSkillMdContent,
  groupSkillObjects,
  parseSkillDescription,
  skillNameFromObjectKey,
  skillObjectKeyForName,
  validateSkillName,
  validateSkillObjectKey,
  validateSkillRelativePath,
} from './service'

describe('validateSkillObjectKey', () => {
  test('accepts keys under skills/', () => {
    expect(validateSkillObjectKey('skills/demo/SKILL.md')).toBe('skills/demo/SKILL.md')
  })

  test('rejects keys outside skills/', () => {
    expect(() => validateSkillObjectKey('demo/SKILL.md')).toThrow()
    expect(() => validateSkillObjectKey('../skills/demo/SKILL.md')).toThrow()
  })

  test('rejects NUL bytes in keys', () => {
    expect(() => validateSkillObjectKey('skills/demo\0/SKILL.md')).toThrow()
  })
})

describe('validateSkillRelativePath', () => {
  test('rejects NUL bytes in paths', () => {
    expect(() => validateSkillRelativePath('scripts\0/run.sh')).toThrow()
  })
})

describe('parseSkillDescription', () => {
  test('reads description from SKILL.md frontmatter', () => {
    const md = `---
name: demo
description: Run the demo playbook
---

# demo
`

    expect(parseSkillDescription(md)).toBe('Run the demo playbook')
  })
})

describe('validateSkillName', () => {
  test('accepts alphanumeric skill names', () => {
    expect(validateSkillName('deploy-checklist')).toBe('deploy-checklist')
  })

  test('rejects empty or invalid names', () => {
    expect(() => validateSkillName('')).toThrow()
    expect(() => validateSkillName('../evil')).toThrow()
  })
})

describe('buildSkillMdContent', () => {
  test('builds SKILL.md with frontmatter and body', () => {
    const md = buildSkillMdContent('demo', 'Run the demo', '# Steps\n\n1. Go')

    expect(md).toContain('name: demo')
    expect(md).toContain('description: Run the demo')
    expect(md).toContain('# Steps')
    expect(parseSkillDescription(md)).toBe('Run the demo')
  })
})

describe('skillObjectKeyForName', () => {
  test('builds keys under skills/<name>/', () => {
    expect(skillObjectKeyForName('demo', 'scripts/run.sh')).toBe('skills/demo/scripts/run.sh')
  })
})

describe('skillNameFromObjectKey', () => {
  test('extracts skill name from object keys', () => {
    expect(skillNameFromObjectKey('skills/aws/SKILL.md')).toBe('aws')
    expect(skillNameFromObjectKey('orphan.txt')).toBeNull()
  })
})

describe('assertSkillNameNotBuiltinOverlay', () => {
  test('rejects names that match builtin skills', async () => {
    await expect(assertSkillNameNotBuiltinOverlay('aws')).rejects.toThrow(
      'Cannot create or overwrite builtin skill: aws',
    )
  })

  test('allows custom skill names', async () => {
    await expect(assertSkillNameNotBuiltinOverlay('my-custom-runbook')).resolves.toBeUndefined()
  })
})

describe('groupSkillObjects', () => {
  test('groups files by skill name and flags orphans', () => {
    const grouped = groupSkillObjects([
      { key: 'skills/demo/SKILL.md', size: 10, etag: 'a' },
      { key: 'skills/demo/scripts/run.sh', size: 5, etag: 'b' },
      { key: 'orphan.txt', size: 1, etag: 'c' },
    ])

    expect(grouped.skills).toHaveLength(1)
    expect(grouped.skills[0]?.name).toBe('demo')
    expect(grouped.skills[0]?.files).toHaveLength(2)
    expect(grouped.orphans).toHaveLength(1)
  })
})
