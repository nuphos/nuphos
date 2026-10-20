import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { agentEnv, agentLoginEnv, deriveControlKey, openabConfigToml, openabEnv } from './config.ts'

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

test('Claude Code runs from a config dir of Nuphos’s own, with the platform credential store', () => {
  const env = agentEnv(launch)

  assert.equal(env.CLAUDE_CONFIG_DIR, '/data/users/u1/claude-home')
  assert.equal(
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
    process.platform === 'darwin' ? '' : launch.agentHome,
  )
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false')
  assert.match(openabConfigToml(launch), /^CLAUDE_CONFIG_DIR = "\/data\/users\/u1\/claude-home"$/mu)
})

test('a custom terminal credential store does not load personal settings', () => {
  const env = agentEnv({
    ...launch,
    env: { ...launch.env, CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' },
  })

  assert.equal(env.CLAUDE_CONFIG_DIR, '/data/users/u1/claude-home')
  assert.equal(
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
    process.platform === 'darwin' ? '/Users/me/.claude-work' : launch.agentHome,
  )
})

test('Claude keeps the host home for Keychain access and filters the owner’s environment', () => {
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

test('the runtime offers only its bundled attachment program as a job', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bundle-'))
  const bundled = { ...launch, bundle: { ...launch.bundle, root } }

  try {
    assert.equal(openabEnv(bundled).OPENAB_RUNTIME_JOBS, undefined)
    writeFileSync(path.join(root, 'attachment-job.mjs'), '')
    const jobs = openabEnv(bundled).OPENAB_RUNTIME_JOBS

    if (process.platform === 'win32') return assert.equal(jobs, undefined)
    assert.equal(
      jobs,
      `attachments=/usr/bin/env ELECTRON_RUN_AS_NODE=1 ${launch.nodeExecPath} ${path.join(root, 'attachment-job.mjs')}`,
    )
    // openab splits the command on whitespace, so a spaced path cannot run.
    assert.equal(
      openabEnv({ ...bundled, nodeExecPath: '/Apps/Nuphos 2.app/Nuphos' }).OPENAB_RUNTIME_JOBS,
      undefined,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only a machine Nuphos made also runs the panel scripts the backend sends', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bundle-'))
  const bundled = { ...launch, bundle: { ...launch.bundle, root } }
  const node = `/usr/bin/env ELECTRON_RUN_AS_NODE=1 ${launch.nodeExecPath}`

  try {
    writeFileSync(path.join(root, 'attachment-job.mjs'), '')
    writeFileSync(path.join(root, 'panel-job.mjs'), '')
    if (process.platform === 'win32') return

    const attachments = `attachments=${node} ${path.join(root, 'attachment-job.mjs')}`

    assert.equal(openabEnv(bundled).OPENAB_RUNTIME_JOBS, attachments)
    assert.equal(openabEnv(bundled).OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS, undefined)
    const env = openabEnv({ ...bundled, ownsMachine: true })

    assert.equal(
      env.OPENAB_RUNTIME_JOBS,
      `${attachments};panel=${node} --max-old-space-size=512 ${path.join(root, 'panel-job.mjs')}`,
    )
    assert.equal(env.OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS, '300000')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the config quotes paths as TOML strings', () => {
  const toml = openabConfigToml({ ...launch, workspace: 'C:\\Users\\me "x"' })

  assert.match(toml, /working_dir = "C:\\\\Users\\\\me \\"x\\""/u)
  assert.match(toml, /^\[agent\.env\]$/mu)
})

test('Codex keeps an isolated home, never the owner’s CODEX_HOME', () => {
  const env = agentEnv({
    ...launch,
    provider: 'codex',
    cliPath: '/Users/me/.local/bin/codex',
    agentHome: '/data/users/u1/codex-home',
    env: { ...launch.env, CODEX_HOME: '/Users/me/codex-work' },
  })

  assert.equal(env.CODEX_PATH, '/Users/me/.local/bin/codex')
  assert.equal(env.CODEX_HOME, '/data/users/u1/codex-home')
  assert.equal(env.CLAUDE_CODE_EXECUTABLE, undefined)
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined)
})

test('an explicit default Keychain override wins over a custom terminal config', () => {
  const env = agentEnv({
    ...launch,
    env: { ...launch.env, CLAUDE_CONFIG_DIR: '/personal', CLAUDE_SECURESTORAGE_CONFIG_DIR: '' },
  })

  assert.equal(env.CLAUDE_CONFIG_DIR, launch.agentHome)
  assert.equal(
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
    process.platform === 'darwin' ? '' : launch.agentHome,
  )
})

test('tunnel sign-in uses bundled wrappers and each provider’s isolated credential directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nuphos-login-wrappers-'))
  // macOS keeps the user's HOME for the Keychain; openab's own HOME stays isolated.
  const prefix =
    process.platform === 'darwin' ? '/usr/bin/env HOME=/Users/me USERPROFILE=/Users/me ' : ''

  try {
    for (const provider of ['claude-code', 'codex'] as const) {
      const wrapper = path.join(root, provider === 'codex' ? 'codex-login.mjs' : 'claude-login.mjs')

      writeFileSync(wrapper, '')
      const env = agentLoginEnv({ ...launch, provider, bundle: { ...launch.bundle, root } })

      assert.equal(
        env.OPENAB_RUNTIME_LOGIN_COMMAND,
        `${prefix}${launch.nodeExecPath} ${wrapper}${provider === 'codex' ? ' --install' : ''}`,
      )
      assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
      if (provider === 'codex') {
        assert.equal(env.CODEX_EXECUTABLE, launch.cliPath)
        assert.equal(env.NUPHOS_CODEX_AUTH_DIRECTORY, launch.agentHome)
      } else assert.equal(env.CLAUDE_CONFIG_DIR, launch.agentHome)
    }
    // Grok Build and OpenCode run the image's wrappers, told the CLI and the agent's home.
    for (const provider of ['grok', 'opencode'] as const) {
      const wrapper = path.join(root, `${provider}-login.mjs`)

      writeFileSync(wrapper, '')
      const env = agentLoginEnv({ ...launch, provider, bundle: { ...launch.bundle, root } })

      assert.equal(env.OPENAB_RUNTIME_LOGIN_COMMAND, `${prefix}${launch.nodeExecPath} ${wrapper}`)
      assert.equal(env.NUPHOS_AGENT_EXECUTABLE, launch.cliPath)
      assert.equal(env.NUPHOS_AGENT_HOME, launch.agentHome)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test(
  'macOS sign-in without a usable HOME is left to the computer',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nuphos-login-wrappers-'))

    try {
      writeFileSync(path.join(root, 'claude-login.mjs'), '')
      const bundled = { ...launch, bundle: { ...launch.bundle, root } }

      assert.equal(openabEnv(bundled).HOME, launch.openabHome)
      assert.deepEqual(
        agentLoginEnv({ ...bundled, env: { ...launch.env, HOME: '/Users/with space' } }),
        {},
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
