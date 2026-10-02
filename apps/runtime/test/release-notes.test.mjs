import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/runtime-release-notes.mjs', import.meta.url))

test('release notes read the tagged runtime subtree and exclude unrelated monorepo commits', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-notes-'))
  const cwd = join(root, 'apps/runtime')
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const commit = (message) => {
    git('add', '.')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message)
  }
  const version = (value) =>
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: value }))

  try {
    mkdirSync(join(cwd, 'image/claude-agent-acp'), { recursive: true })
    mkdirSync(join(cwd, 'image/codex-acp'), { recursive: true })
    git('init', '-b', 'main')
    version('0.1.0')
    writeFileSync(
      join(cwd, 'image/claude-agent-acp/package.json'),
      JSON.stringify({
        overrides: { '@anthropic-ai/claude-agent-sdk': '0.3.286' },
        dependencies: { '@agentclientprotocol/claude-agent-acp': '0.74.0' },
      }),
    )
    writeFileSync(
      join(cwd, 'image/codex-acp/package.json'),
      JSON.stringify({
        dependencies: { '@openai/codex': '0.159.3', '@agentclientprotocol/codex-acp': '1.1.4' },
      }),
    )
    commit('runtime baseline')
    git('tag', 'runtime-v0.1.0')
    writeFileSync(join(root, 'desktop.txt'), 'unrelated')
    commit('unrelated desktop change')
    git('tag', 'v99.0.0')
    version('0.1.1')
    commit('runtime fix')
    git('tag', 'runtime-v0.1.1')
    // Working tree edits must not leak into release metadata.
    version('0.1.2')
    const notes = execFileSync(process.execPath, [script, 'runtime-v0.1.1', 'both'], {
      cwd,
      encoding: 'utf8',
    })

    assert.match(notes, /runtime fix/)
    assert.doesNotMatch(notes, /unrelated desktop change|runtime baseline|0\.1\.2/)
    assert.match(notes, /ghcr\.io\/zeabur\/nuphos-runtime:0\.1\.1-claude-code/)
    assert.match(notes, /ghcr\.io\/zeabur\/nuphos-runtime:0\.1\.1-codex/)
    assert.match(notes, /nuphos\/nuphos\/compare\/runtime-v0\.1\.0\.\.\.runtime-v0\.1\.1/)
    assert.throws(() =>
      execFileSync(process.execPath, [script, 'v99.0.0', 'both'], { cwd, stdio: 'pipe' }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
