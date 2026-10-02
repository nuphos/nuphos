import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dockerfile = readFileSync(new URL('../image/Dockerfile', import.meta.url), 'utf8')
const build = readFileSync(
  new URL('../../../.github/workflows/runtime-build.yml', import.meta.url),
  'utf8',
)

test('the image hands OpenAB a display label and version for its status page', () => {
  assert.match(dockerfile, /^ARG RUNTIME_LABEL$/mu)
  assert.match(dockerfile, /^ARG RUNTIME_VERSION$/mu)
  assert.match(dockerfile, /^ENV OPENAB_RUNTIME_LABEL="\$\{RUNTIME_LABEL\}" \\$/mu)
  assert.match(dockerfile, /^ {4}OPENAB_RUNTIME_VERSION="\$\{RUNTIME_VERSION\}"$/mu)
})

test('the published Codex and Claude Code images each pass their own label plus the release version', () => {
  assert.ok(build.includes("LABEL='Codex'"))
  assert.ok(build.includes("LABEL='Claude Code'"))
  assert.ok(build.includes('RUNTIME_LABEL=${{ steps.tags.outputs.label }}'))
  assert.ok(build.includes('RUNTIME_VERSION=${{ needs.plan.outputs.version }}'))
})

test('the image turns on the runtime console with its state on the home volume', () => {
  assert.match(dockerfile, /^ {4}OPENAB_RUNTIME_CONSOLE=true \\$/mu)
  assert.match(dockerfile, /^ {4}OPENAB_RUNTIME_STATE_DIR=\/home\/node\/\.nuphos-runtime \\$/mu)
  assert.match(
    dockerfile,
    /^ {4}OPENAB_RUNTIME_CONNECT_URL_TEMPLATE="nuphos:\/\/connect-runtime\?url=\{url\}&code=\{code\}&exp=\{exp\}"$/mu,
  )
})
