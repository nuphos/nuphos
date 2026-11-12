import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installableNames, MAX_INSTALL_NAMES, previewSourceLabel } from './githubSkillInstall.ts'

import type { GithubSkillPreview } from '../../api/plan-types.ts'

const candidate = (name: string, problem: string | null) => ({
  name,
  description: null,
  path: `skills/${name}`,
  fileCount: 1,
  totalBytes: 10,
  skipped: [],
  problem: problem ? { code: problem, message: problem } : null,
})
const preview: GithubSkillPreview = {
  repo: 'o/r',
  ref: 'main',
  subpath: 'skills',
  commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
  skills: [candidate('pdf', null), candidate('leaky', 'secret'), candidate('docx', null)],
  truncated: false,
}

test('preselects only skills without a problem', () => {
  assert.deepEqual(installableNames(preview), ['pdf', 'docx'])
})

test('preselects no more than one install accepts', () => {
  const many = Array.from({ length: 80 }, (_, i) => candidate(`s${String(i)}`, null))

  assert.equal(installableNames({ ...preview, skills: many }).length, MAX_INSTALL_NAMES)
})

test('labels the resolved source with its short commit', () => {
  assert.equal(previewSourceLabel(preview), 'o/r/skills @ main (abcdef1)')
  assert.equal(previewSourceLabel({ ...preview, ref: null, subpath: null }), 'o/r (abcdef1)')
})
