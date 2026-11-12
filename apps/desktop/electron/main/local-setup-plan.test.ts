import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  instructionTitle,
  MAX_SYNCED_SKILL_BYTES,
  planSkillSync,
  RUNTIME_FILE_BUDGET,
  splitInstruction,
} from './local-setup-plan.ts'

import type { LocalSkillSnapshot } from './local-setup-plan.ts'

function skill(
  name: string,
  files: Record<string, [size: number, sha: string]>,
): LocalSkillSnapshot {
  return {
    name,
    files: Object.entries(files).map(([relPath, [size, sha256]]) => ({ relPath, size, sha256 })),
  }
}

describe('planSkillSync', () => {
  it('uploads new skills and only the changed files of synced ones', () => {
    const plan = planSkillSync(
      [
        skill('deploy', { 'SKILL.md': [10, 'a'], 'run.sh': [5, 'new'] }),
        skill('triage', { 'SKILL.md': [3, 'c'] }),
      ],
      { deploy: { 'SKILL.md': 'a', 'run.sh': 'old' } },
      [
        { key: 'skills/deploy/SKILL.md', size: 10 },
        { key: 'skills/deploy/run.sh', size: 4 },
      ],
    )

    assert.deepEqual(plan.synced, ['triage', 'deploy'])
    assert.deepEqual(
      plan.uploads.map((upload) => upload.key),
      ['skills/triage/SKILL.md', 'skills/deploy/run.sh'],
    )
    assert.deepEqual(plan.deleteKeys, [])
    assert.deepEqual(plan.deleteSkills, [])
  })

  it('re-uploads a synced file that went missing from the store', () => {
    const plan = planSkillSync(
      [skill('deploy', { 'SKILL.md': [10, 'a'] })],
      { deploy: { 'SKILL.md': 'a' } },
      [],
    )

    assert.deepEqual(
      plan.uploads.map((upload) => upload.key),
      ['skills/deploy/SKILL.md'],
    )
  })

  it('removes files and skills deleted locally, but never ones it did not sync', () => {
    const plan = planSkillSync(
      [skill('deploy', { 'SKILL.md': [10, 'a'] })],
      { deploy: { 'SKILL.md': 'a', 'old.md': 'x' }, gone: { 'SKILL.md': 'y' } },
      [
        { key: 'skills/deploy/SKILL.md', size: 10 },
        { key: 'skills/deploy/old.md', size: 1 },
        { key: 'skills/gone/SKILL.md', size: 1 },
        { key: 'skills/handmade/SKILL.md', size: 1 },
      ],
    )

    assert.deepEqual(plan.deleteKeys, ['skills/deploy/old.md'])
    assert.deepEqual(plan.deleteSkills, ['gone'])
  })

  it('leaves a personal skill made in Nuphos alone when a local one shares its name', () => {
    const plan = planSkillSync([skill('handmade', { 'SKILL.md': [1, 'a'] })], {}, [
      { key: 'skills/handmade/SKILL.md', size: 1 },
    ])

    assert.deepEqual(plan.synced, [])
    assert.deepEqual(plan.skipped, [{ name: 'handmade', reason: 'name_taken' }])
  })

  it('skips a skill whose SKILL.md could not be read', () => {
    const plan = planSkillSync([skill('linked', { 'notes.md': [1, 'a'] })], {}, [])

    assert.deepEqual(plan.synced, [])
    assert.deepEqual(plan.skipped, [{ name: 'linked', reason: 'unreadable' }])
  })

  it('skips an unreviewed skill and keeps the copy it synced before', () => {
    const waiting = { ...skill('deploy', {}), unreviewed: true }
    const plan = planSkillSync([waiting], { deploy: { 'SKILL.md': 'a' } }, [
      { key: 'skills/deploy/SKILL.md', size: 1 },
    ])

    assert.deepEqual(plan.skipped, [{ name: 'deploy', reason: 'needs_review' }])
    assert.deepEqual(plan.deleteSkills, [])
    assert.deepEqual(plan.uploads, [])
  })

  it('keeps a synced skill whose files could not be read this pass', () => {
    const plan = planSkillSync(
      [skill('deploy', {}), skill('triage', { 'SKILL.md': [2, 't'] })],
      { deploy: { 'SKILL.md': 'a', 'run.sh': 'b' } },
      [
        { key: 'skills/deploy/SKILL.md', size: 1 },
        { key: 'skills/deploy/run.sh', size: 1 },
      ],
    )

    assert.deepEqual(plan.skipped, [{ name: 'deploy', reason: 'unreadable' }])
    assert.deepEqual(plan.deleteSkills, [])
    assert.deepEqual(plan.deleteKeys, [])
    assert.deepEqual(plan.synced, ['triage'])
  })

  it('never plans deletions from a walk an entry cap cut short', () => {
    const partial = { ...skill('deploy', { 'SKILL.md': [1, 'a'] }), truncated: true }
    const plan = planSkillSync([partial], { deploy: { 'SKILL.md': 'a', 'scripts/run.sh': 'b' } }, [
      { key: 'skills/deploy/SKILL.md', size: 1 },
      { key: 'skills/deploy/scripts/run.sh', size: 1 },
    ])

    assert.deepEqual(plan.skipped, [{ name: 'deploy', reason: 'too_many_files' }])
    assert.deepEqual(plan.deleteKeys, [])
  })

  it('skips skills too large or truncated by the walk', () => {
    const many = Object.fromEntries(
      // Cut off at 200 files before the walk reached SKILL.md, as a large checkout is.
      Array.from({ length: 200 }, (_, i) => [`f${String(i)}.md`, [1, 'x'] as [number, string]]),
    )
    const plan = planSkillSync(
      [skill('huge', { 'SKILL.md': [MAX_SYNCED_SKILL_BYTES + 1, 'a'] }), skill('wide', many)],
      {},
      [],
    )

    assert.deepEqual(plan.skipped, [
      { name: 'huge', reason: 'too_large' },
      { name: 'wide', reason: 'too_many_files' },
    ])
  })

  it('fits the smallest skills into the runtime budget and drops a synced one that no longer fits', () => {
    const big = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [
        i ? `f${String(i)}.md` : 'SKILL.md',
        [1, 'x'] as [number, string],
      ]),
    )
    const local = Array.from({ length: 13 }, (_, i) => skill(`s${String(i).padStart(2, '0')}`, big))
    const plan = planSkillSync(local, { s12: {} }, [])

    assert.equal(plan.synced.length, Math.floor(RUNTIME_FILE_BUDGET / 150))
    assert.deepEqual(plan.skipped, [{ name: 's12', reason: 'over_budget' }])
    assert.deepEqual(plan.deleteSkills, ['s12'])
  })
})

describe('splitInstruction', () => {
  it('keeps a short file whole', () => {
    assert.deepEqual(splitInstruction('\n# Rules\n\n- be brief\n', 100), ['# Rules\n\n- be brief'])
  })

  it('splits at line breaks within the limit', () => {
    const parts = splitInstruction(['aaaa', 'bbbb', 'cccc'].join('\n'), 9)

    assert.deepEqual(parts, ['aaaa\nbbbb', 'cccc'])
    assert.ok(parts.every((part) => part.length <= 9))
  })

  it('hard-wraps a line longer than the limit', () => {
    assert.deepEqual(splitInstruction(`x\n${'y'.repeat(7)}`, 3), ['x', 'yyy', 'yyy', 'y'])
  })

  it('is empty for an empty file', () => {
    assert.deepEqual(splitInstruction('  \n', 10), [])
  })
})

describe('instructionTitle', () => {
  it('numbers parts only when there are several', () => {
    assert.equal(instructionTitle(0, 1), 'CLAUDE.md from this computer')
    assert.equal(instructionTitle(1, 2), 'CLAUDE.md from this computer (2 of 2)')
  })
})
