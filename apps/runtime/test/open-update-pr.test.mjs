import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const script = new URL('../scripts/open-update-pr.sh', import.meta.url).pathname

// Runs the script with gh stubbed on PATH: it records each call, reports
// openPr for `pr list` (what gh prints after --jq), and a URL for `pr create`.
function run(openPr, title) {
  const bin = mkdtempSync(join(tmpdir(), 'nuphos-update-pr-'))
  const calls = join(bin, 'calls')
  writeFileSync(join(bin, 'open-pr'), openPr)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh
echo "$*" >> ${calls}
case "$*" in
  "pr list"*) cat ${bin}/open-pr ;;
  "pr create"*) echo https://github.com/nuphos/nuphos/pull/410 ;;
  *graphql*) cat > /dev/null ;;
esac
`,
  )
  chmodSync(join(bin, 'gh'), 0o755)

  const result = spawnSync('bash', [script, 'runtime/update', title, 'apps/runtime/package.json'], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'nuphos/nuphos',
      GITHUB_WORKFLOW: 'Update Claude SDK',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '1',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []
}

test('a stale update pull request is closed before its branch is reset to main', () => {
  const log = run('403\tfix(runtime): update to 1.0.0\n', 'fix(runtime): update to 1.0.1')
  const close = log.findIndex((call) => call.startsWith('pr close 403'))
  const reset = log.findIndex((call) => call.includes('git/refs/heads/runtime/update'))
  const create = log.findIndex((call) => call.startsWith('pr create'))
  const comment = log.findIndex((call) =>
    call.startsWith('pr comment 403 --repo nuphos/nuphos --body Superseded by https://'),
  )
  assert.ok(close !== -1 && close < reset && reset < create && create < comment, log.join('\n'))
  assert.match(log[0], /--app github-actions/)
})

test('an open pull request that already carries the update is left alone', () => {
  const log = run('409\tfix(runtime): update to 1.0.1\n', 'fix(runtime): update to 1.0.1')
  assert.deepEqual(
    log.filter((call) => !call.startsWith('pr list')),
    [],
  )
})
