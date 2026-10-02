import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const VARIANTS = ['claude-code', 'codex']
const dockerfile = readFileSync(new URL('../image/Dockerfile', import.meta.url), 'utf8')
const configs = new Map(
  VARIANTS.map((variant) => [
    variant,
    readFileSync(new URL(`../image/openab-config.${variant}.toml`, import.meta.url), 'utf8'),
  ]),
)

test('every published variant boots without a mounted config', () => {
  assert.match(
    dockerfile,
    /install -m 644 "\/tmp\/nuphos-config\/openab-config\.\$\{RUNTIME_PROVIDER\}\.toml" \\\n\s+\/etc\/openab\/config\.toml/,
    'the image must install a default at the path openab is told to read',
  )
  for (const variant of VARIANTS) {
    assert.match(dockerfile, new RegExp(`openab-config\\.${variant}\\.toml`))
  }
})

test('the default never shadows the agent command the image bakes', () => {
  // command is resolved from OPENAB_AGENT_COMMAND only while the file omits
  // it; a value here would pin the wrong adapter for a variant forever.
  for (const [variant, config] of configs) {
    assert.doesNotMatch(config, /^\s*command\s*=/mu, `${variant} pins [agent].command`)
  }
})

test('the default carries nothing tied to one deployment', () => {
  for (const [variant, config] of configs) {
    assert.doesNotMatch(config, /:\/\//u, `${variant} bakes a URL`)
    // The one working directory allowed is the one the image itself creates, so it is
    // an image fact like BASH_ENV's path, not a host path. Any other value would be.
    for (const [, dir] of config.matchAll(/^\s*working_dir\s*=\s*"([^"]*)"/gmu))
      assert.equal(dir, '/workspace', `${variant} pins a host path`)
    assert.doesNotMatch(config, /^\s*max_sessions\s*=/mu, `${variant} pins pool capacity`)
  }
})

test('codex stays in full-access mode when openab restores a session', () => {
  const config = configs.get('codex')
  assert.match(config, /^INITIAL_AGENT_MODE = "agent-full-access"$/mu)
  assert.doesNotMatch(config, /default_config_options/u)
})
