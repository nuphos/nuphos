import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

test('a bundled Node host imports AGY status without running its CLI entry point', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nuphos-agy-status-bundle-'))

  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = fileURLToPath(
    new URL('../../../../runtime/image/antigravity-status.mjs', import.meta.url),
  )
  const entry = path.join(directory, 'entry.mjs')
  const outDir = path.join(directory, 'bundle')

  writeFileSync(
    entry,
    `import { antigravityStatus } from ${JSON.stringify(source)}; process.stdout.write(typeof antigravityStatus)`,
  )
  await build({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: entry,
      outDir,
      emptyOutDir: true,
      rollupOptions: { output: { format: 'esm', entryFileNames: 'entry.mjs' } },
    },
  })
  const stdout = execFileSync(process.execPath, [path.join(outDir, 'entry.mjs')], {
    env: { ...process.env, NUPHOS_AGENT_EXECUTABLE: path.join(directory, 'missing-agy') },
    encoding: 'utf8',
  })

  assert.equal(stdout, 'function')
})
