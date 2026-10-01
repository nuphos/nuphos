import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readCloudCliVersion } from './cloud-cli-version.ts'

import type { CloudCliProvider } from '../../src/lib/cloudCli.ts'

test('reads provider versions from the detected path, including stderr', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-cli-version-'))

  t.after(() => rm(dir, { recursive: true, force: true }))
  const executable = join(dir, 'cli with spaces')
  const cases: [CloudCliProvider, string, string, string][] = [
    ['aws', '--version', 'aws-cli/2.31.0 Python/3.13 Darwin/24', '2.31.0'],
    ['gcp', '--version', 'Google Cloud SDK 530.0.0\\nbq 2.1.0', '530.0.0'],
    ['azure', '--version', 'azure-cli                         2.77.0\\ncore 2.77.0', '2.77.0'],
    ['aliyun', 'version', '3.0.280', '3.0.280'],
    ['tencent', '--version', '3.0.1400.1', '3.0.1400.1'],
    ['volcengine', '--version', 've version 1.0.20', '1.0.20'],
    ['huawei', 'version', 'Current Cloud CLI version: 3.2.8', '3.2.8'],
  ]

  for (const [provider, arg, output, expected] of cases) {
    await writeFile(
      executable,
      `#!/bin/sh\n[ "$1" = "${arg}" ] || exit 1\nprintf '${output}\\n' >&2\n`,
      { mode: 0o700 },
    )
    assert.equal(await readCloudCliVersion(provider, executable, process.env), expected, provider)
  }
})

test('version failure, unexpected output, missing executable and timeout are nonfatal', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-cli-version-'))

  t.after(() => rm(dir, { recursive: true, force: true }))
  const executable = join(dir, 'aws')

  assert.equal(await readCloudCliVersion('aws', executable, process.env), null)
  for (const script of [
    'echo aws-cli/2.31.0; exit 1',
    'echo warning Python/3.13',
    'while :; do :; done',
  ]) {
    await writeFile(executable, `#!/bin/sh\n${script}\n`, { mode: 0o700 })
    assert.equal(await readCloudCliVersion('aws', executable, process.env, 100), null)
  }
})

test('allows a slow CLI startup beyond the previous two-second deadline', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-cli-version-'))

  t.after(() => rm(dir, { recursive: true, force: true }))
  const executable = join(dir, 'aws')

  await writeFile(executable, '#!/bin/sh\nsleep 2.1\necho aws-cli/2.12.5\n', { mode: 0o700 })
  assert.equal(await readCloudCliVersion('aws', executable, process.env), '2.12.5')
})
