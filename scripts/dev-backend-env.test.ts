import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const moduleUrl = new URL('./dev-backend-env.ts', import.meta.url).href

test('backend local overrides beat shared images and are reread on restart', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nuphos-env-test-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'apps/backend'), { recursive: true })
  writeFileSync(join(root, '.env'), 'CODEX_RUNTIME_IMAGE=root\n')
  writeFileSync(join(root, '.env.local'), 'CODEX_RUNTIME_IMAGE=root-local\n')
  writeFileSync(join(root, 'apps/backend/.env'), 'CLAUDE_CODE_RUNTIME_IMAGE=shared-old\n')
  writeFileSync(join(root, 'apps/backend/.env.local'), 'CLAUDE_CODE_RUNTIME_IMAGE=local-new\n')
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import { backendEnv } from ${JSON.stringify(moduleUrl)};
    import { writeFileSync, unlinkSync } from 'node:fs';
    const results = [];
    const read = () => { const env = backendEnv(); results.push([env.CLAUDE_CODE_RUNTIME_IMAGE, env.CODEX_RUNTIME_IMAGE]); };
    read();
    writeFileSync('apps/backend/.env.local', 'CLAUDE_CODE_RUNTIME_IMAGE=local-updated\\n');
    read();
    unlinkSync('apps/backend/.env.local');
    read();
    console.log(JSON.stringify(results));
  `,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_RUNTIME_IMAGE: 'inherited-old' },
    },
  )

  assert.deepEqual(JSON.parse(output), [
    ['local-new', 'root-local'],
    ['local-updated', 'root-local'],
    ['shared-old', 'root-local'],
  ])
})
