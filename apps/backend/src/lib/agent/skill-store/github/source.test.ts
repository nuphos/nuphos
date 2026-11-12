import { describe, expect, test } from 'bun:test'

import { parseGithubSource } from './source'

describe('parseGithubSource', () => {
  test.each([
    ['anthropics/skills', { owner: 'anthropics', repo: 'skills', ref: null, subpath: null }],
    ['owner/repo/skills/pdf', { owner: 'owner', repo: 'repo', ref: null, subpath: 'skills/pdf' }],
    ['owner/repo#v1.2', { owner: 'owner', repo: 'repo', ref: 'v1.2', subpath: null }],
    [
      'https://github.com/owner/repo.git',
      { owner: 'owner', repo: 'repo', ref: null, subpath: null },
    ],
    [
      'https://github.com/owner/repo/tree/main/skills/pdf/',
      { owner: 'owner', repo: 'repo', ref: 'main', subpath: 'skills/pdf' },
    ],
    [
      'https://github.com/owner/repo/blob/dev/skills/pdf/SKILL.md',
      { owner: 'owner', repo: 'repo', ref: 'dev', subpath: 'skills/pdf' },
    ],
    [
      'github.com/owner/repo/tree/feature/x#feature/x',
      { owner: 'owner', repo: 'repo', ref: 'feature/x', subpath: 'x' },
    ],
  ])('%s', (input, expected) => {
    expect(parseGithubSource(input)).toEqual(expected)
  })

  test.each([
    'https://gitlab.com/owner/repo',
    'owner',
    'owner/repo/../../etc',
    'owner/repo#../main',
    'ow ner/repo',
  ])('rejects %s', (input) => {
    expect(() => parseGithubSource(input)).toThrow()
  })
})
