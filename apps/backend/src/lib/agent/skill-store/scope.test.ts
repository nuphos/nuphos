import { describe, expect, test } from 'bun:test'

import {
  normalizeSkillScope,
  s3KeyToCacheRelativePath,
  skillObjectKey,
  skillScopeS3Prefix,
} from './scope'

describe('normalizeSkillScope', () => {
  test('accepts global and team scopes', () => {
    expect(normalizeSkillScope('global')).toBe('global')
    expect(normalizeSkillScope('teams/64f1a2b3c4d5e6f7a8b9c0d1')).toBe(
      'teams/64f1a2b3c4d5e6f7a8b9c0d1',
    )
  })

  test('rejects traversal and slashes', () => {
    expect(() => normalizeSkillScope('')).toThrow()
    expect(() => normalizeSkillScope('../global')).toThrow()
    expect(() => normalizeSkillScope('/global')).toThrow()
    expect(() => normalizeSkillScope('global/')).toThrow()
  })
})

describe('skillScopeS3Prefix', () => {
  test('appends skills segment', () => {
    expect(skillScopeS3Prefix('global')).toBe('global/skills/')
    expect(skillScopeS3Prefix('teams/abc')).toBe('teams/abc/skills/')
  })
})

describe('s3KeyToCacheRelativePath', () => {
  test('strips scope prefix', () => {
    expect(s3KeyToCacheRelativePath('global', 'global/skills/deploy/SKILL.md')).toBe(
      'skills/deploy/SKILL.md',
    )
  })

  test('rejects keys outside scope', () => {
    expect(() => s3KeyToCacheRelativePath('global', 'teams/x/skills/a/SKILL.md')).toThrow()
  })
})

describe('skillObjectKey', () => {
  test('builds full S3 keys', () => {
    expect(skillObjectKey('global', 'skills/foo/SKILL.md')).toBe('global/skills/foo/SKILL.md')
  })

  test('rejects traversal in relative key', () => {
    expect(() => skillObjectKey('teams/abc', '../../global/skills/x/SKILL.md')).toThrow()
    expect(() => skillObjectKey('global', 'skills/../../etc/passwd')).toThrow()
  })
})
