import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkLegacyVersion } from '../scripts/check-legacy-version.mjs'

const refs = 'abc\trefs/tags/v0.1.9\ndef\trefs/tags/v0.1.10\n'
test('legacy image versions cannot be reused or downgraded', () => {
  for (const version of ['0.1.9', '0.1.10', '0.0.99']) {
    assert.throws(() => checkLegacyVersion(version, refs), /must be newer/)
  }
  for (const version of ['0.1.11', '0.2.0', '1.0.0']) checkLegacyVersion(version, refs)
  assert.throws(() => checkLegacyVersion('0.1.11-rc.1', refs), /Invalid/)
})

test('untagged builds cannot overwrite semantic image tags', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/runtime-build.yml', import.meta.url),
    'utf8',
  )
  const step = workflow
    .split('      - name: Resolve image tags\n')[1]
    .split('      - name: Login to GHCR\n')[0]
  const script = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
  const directory = mkdtempSync(join(tmpdir(), 'runtime-release-'))
  try {
    for (const provider of ['claude', 'codex']) {
      for (const releaseTag of ['', 'runtime-v0.1.11']) {
        const output = join(directory, `${provider}-${releaseTag}.txt`)
        execFileSync('bash', ['-c', script], {
          env: {
            ...process.env,
            PROVIDER: provider,
            VERSION: '0.1.11',
            SHA12: 'gateway12345',
            BUILD_SHA: 'runtimeabcdef',
            RELEASE_TAG: releaseTag,
            RUNTIME_IMAGE: 'ghcr.io/nuphos/runtime',
            GITHUB_OUTPUT: output,
          },
        })
        const tags = Object.fromEntries(
          readFileSync(output, 'utf8')
            .trim()
            .split('\n')
            .map((line) => {
              const at = line.indexOf('=')
              return [line.slice(0, at), line.slice(at + 1)]
            }),
        )
        const variant = provider === 'claude' ? 'claude-code' : 'codex'
        assert.equal(tags.runtime_tags.includes(`:0.1.11-${variant}`), Boolean(releaseTag))
        assert.equal(tags.base_tags.includes(`:0.1.11-base-${variant}`), Boolean(releaseTag))
        assert.ok(tags.runtime_tags.includes(`:commit-runtimeabcdef-${variant}`))
        assert.ok(tags.base_tags.includes(`:gateway12345-base-${variant}`))
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
