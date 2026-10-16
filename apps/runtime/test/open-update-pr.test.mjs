import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const script = new URL('../scripts/open-update-pr.sh', import.meta.url).pathname

test('a stale update pull request is closed before its branch is reset to main', () => {
  // Stub gh on PATH to record each call and report open pull request 403.
  const bin = mkdtempSync(join(tmpdir(), 'nuphos-update-pr-'))
  const calls = join(bin, 'calls')
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\necho "$*" >> ${calls}\ncase "$*" in "pr list"*) echo 403 ;; *graphql*) cat > /dev/null ;; esac\n`,
  )
  chmodSync(join(bin, 'gh'), 0o755)

  const result = spawnSync(
    'bash',
    [script, 'runtime/update', 'fix(runtime): update', 'apps/runtime/package.json'],
    {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'nuphos/nuphos',
        GITHUB_WORKFLOW: 'Update Claude SDK',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '1',
      },
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0, result.stderr)
  const log = readFileSync(calls, 'utf8').split('\n')
  const close = log.findIndex((call) => call.startsWith('pr close 403'))
  const reset = log.findIndex((call) => call.includes('git/refs/heads/runtime/update'))
  assert.ok(close !== -1 && close < reset, log.join('\n'))
  assert.ok(log.some((call) => call.startsWith('pr create')))
})
