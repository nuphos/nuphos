import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { claudeHomeSettings, prepareClaudeHome } from './agent-home.ts'

test('Claude Code’s home keeps the owner’s CLAUDE.md files above the workspace out', () => {
  const excludes = claudeHomeSettings('/Users/me/Library/Nuphos/users/u1/workspace')
    .claudeMdExcludes as string[]

  for (const file of [
    '/Users/me/.claude/CLAUDE.md',
    '/Users/me/.claude/rules/**',
    '/Users/me/CLAUDE.md',
    '/Users/me/CLAUDE.local.md',
    '/CLAUDE.md',
  ])
    assert.ok(excludes.includes(file), file)
  assert.ok(
    !excludes.some((file) => file.startsWith('/Users/me/Library/Nuphos/users/u1/workspace/')),
  )
})

test('Claude Code’s home turns off the owner’s claude.ai skills and plugins', () => {
  const settings = claudeHomeSettings('/w')

  assert.equal(settings.syncClaudeAiSkills, false)
  assert.equal(settings.syncClaudeAiPlugins, false)
})

test('the prepared home holds only Nuphos’s own settings, readable by the owner alone', (t) => {
  const userDir = mkdtempSync(path.join(os.tmpdir(), 'claude-home-'))

  t.after(() => {
    rmSync(userDir, { recursive: true, force: true })
  })
  const workspace = path.join(userDir, 'workspace')
  const home = prepareClaudeHome(userDir, workspace)

  assert.equal(home, path.join(userDir, 'claude-home'))
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')),
    claudeHomeSettings(workspace),
  )
  if (process.platform !== 'win32') assert.equal(statSync(home).mode & 0o777, 0o700)
})
