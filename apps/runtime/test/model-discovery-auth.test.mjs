import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

function probe(error, flag) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-probe-auth-'))
  try {
    writeFileSync(
      join(dir, 'codex-acp'),
      `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const r=JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,...(r.id===1?{result:{protocolVersion:1}}:{error:${JSON.stringify(error)}})})+'\\n');
});\n`,
      { mode: 0o755 },
    )
    return spawnSync(
      process.execPath,
      [resolve('test/model-discovery.mjs'), 'codex', ...(flag ? ['--allow-unauthenticated'] : [])],
      {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ACP_DISCOVERY_CWD: dir },
        encoding: 'utf8',
        timeout: 5000,
      },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('account-free CI explicitly accepts only the native authentication-required response', () => {
  const auth = { code: -32000, message: 'Authentication required' }
  const result = probe(auth, true)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { models: [], authenticationRequired: true })
  assert.notEqual(probe(auth, false).status, 0)
  assert.notEqual(probe({ code: -32603, message: 'Internal error' }, true).status, 0)
})
