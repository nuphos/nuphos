import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { agentEnv, deriveControlKey, openabConfigToml, openabEnv } from './config.ts'

import type { LocalRuntimeLaunch } from './config.ts'

const adapter = {
  entry: '/b/adapters/claude-code/index.js',
  bridge: '/b/adapters/claude-code/mcp-http-bridge.mjs',
  version: 'claude-agent-acp@0.74.0',
}
const launch: LocalRuntimeLaunch = {
  provider: 'claude-code',
  bundle: { root: '/b', openab: '/b/openab', adapters: { 'claude-code': adapter } },
  adapter,
  nodeExecPath: '/Applications/Nuphos.app/Contents/MacOS/Nuphos',
  cliPath: '/Users/me/.local/bin/claude',
  agentHome: '/data/users/u1/claude-home',
  workspace: '/data/users/u1/workspace',
  openabHome: '/data/users/u1/openab-home',
  port: 43210,
  authKey: 'a'.repeat(64),
  env: { HOME: '/Users/me', PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'secret' },
}

test('Claude Code runs from a config dir of Nuphos’s own, on the owner’s login', () => {
  const env = agentEnv(launch)

  assert.equal(env.CLAUDE_CONFIG_DIR, '/data/users/u1/claude-home')
  assert.equal(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, '')
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false')
  assert.match(openabConfigToml(launch), /^CLAUDE_CONFIG_DIR = "\/data\/users\/u1\/claude-home"$/mu)
})

test('an owner with their own Claude config dir keeps the login stored for it', () => {
  const env = agentEnv({
    ...launch,
    env: { ...launch.env, CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' },
  })

  assert.equal(env.CLAUDE_CONFIG_DIR, '/data/users/u1/claude-home')
  assert.equal(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/Users/me/.claude-work')
})

test('the agent gets its tools and the real home, not the owner’s whole environment', () => {
  const env = agentEnv(launch)

  assert.equal(env.HOME, '/Users/me')
  assert.equal(env.CLAUDE_CODE_EXECUTABLE, launch.cliPath)
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.NUPHOS_RUNTIME_WORKSPACE, launch.workspace)
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
})

test('openab listens on loopback only, with a control key it cannot confuse with the password', () => {
  const env = openabEnv(launch)

  assert.equal(env.GATEWAY_LISTEN, '127.0.0.1:43210')
  assert.equal(env.OPENAB_ACP_AUTH_KEY, launch.authKey)
  assert.notEqual(env.OPENAB_ACP_CONTROL_KEY, launch.authKey)
  const transportKey = launch.authKey

  assert.equal(
    deriveControlKey(transportKey),
    createHmac('sha256', transportKey).update('nuphos-runtime-control-v1').digest('hex'),
  )
  assert.equal(env.HOME, launch.openabHome)
})

test('the config quotes paths as TOML strings', () => {
  const toml = openabConfigToml({ ...launch, workspace: 'C:\\Users\\me "x"' })

  assert.match(toml, /working_dir = "C:\\\\Users\\\\me \\"x\\""/u)
  assert.match(toml, /^\[agent\.env\]$/mu)
})

test('Codex runs the user’s own codex from a home holding only their login', () => {
  const env = agentEnv({
    ...launch,
    provider: 'codex',
    cliPath: '/Users/me/.local/bin/codex',
    agentHome: '/data/users/u1/codex-home',
  })

  assert.equal(env.CODEX_PATH, '/Users/me/.local/bin/codex')
  assert.equal(env.CODEX_HOME, '/data/users/u1/codex-home')
  assert.equal(env.CLAUDE_CODE_EXECUTABLE, undefined)
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined)
})
