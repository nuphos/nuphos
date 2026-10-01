import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'

let shellPath = ''

mock.module('../shell-env.ts', {
  namedExports: { resolveShellEnv: async () => ({ PATH: shellPath }) },
})
const { probeCloudCli, probeCloudCliVersion } = await import('./cloud-cli-probe.ts')

test('version uses the detected executable and environment even after PATH changes', async (t) => {
  const first = await mkdtemp(join(tmpdir(), 'cloud-cli-first-'))
  const second = await mkdtemp(join(tmpdir(), 'cloud-cli-second-'))

  t.after(async () => {
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  })
  await writeFile(join(first, 'gcloud'), '#!/bin/sh\necho "Google Cloud SDK 1.2.3"\n', {
    mode: 0o700,
  })
  await writeFile(join(second, 'gcloud'), '#!/bin/sh\necho "Google Cloud SDK 4.5.6"\n', {
    mode: 0o700,
  })
  shellPath = first
  const detected = await probeCloudCli('gcp')

  assert.equal(detected.path, join(first, 'gcloud'))
  assert.ok(detected.probeId)
  shellPath = second
  assert.equal(await probeCloudCliVersion('gcp', detected.probeId), '1.2.3')
  assert.equal(await probeCloudCliVersion('aws', detected.probeId), null)
  assert.equal(await probeCloudCliVersion('gcp', 'unknown'), null)
  assert.equal(await probeCloudCliVersion('gcp'), null)
})
