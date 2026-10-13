import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dockerfile = readFileSync(new URL('../image/Dockerfile', import.meta.url), 'utf8')
const build = readFileSync(
  new URL('../../../.github/workflows/runtime-build.yml', import.meta.url),
  'utf8',
)

const LOGIN_COMMAND = 'node /opt/nuphos-runtime/codex-login.mjs --install'
const AUTH_FILE = '/home/node/.codex/auth.json'
const CLAUDE_LOGIN_COMMAND = 'node /opt/nuphos-runtime/claude-login.mjs'
// Where Claude Code on Linux keeps the login `claude auth login` or `/login` stores, and
// where the agent reads it from when no CLAUDE_CODE_OAUTH_TOKEN is set.
const CLAUDE_AUTH_FILE = '/home/node/.claude/.credentials.json'
const GROK_LOGIN_COMMAND = 'node /opt/nuphos-runtime/grok-login.mjs'
const GROK_AUTH_FILE = '/home/node/.grok/auth.json'
const ANTIGRAVITY_LOGIN_COMMAND = 'node /opt/nuphos-runtime/antigravity-login.mjs'
const ANTIGRAVITY_AUTH_FILE = '/home/node/.gemini/antigravity-acp/acp_token.json'
const OPENCODE_LOGIN_COMMAND = 'node /opt/nuphos-runtime/opencode-login.mjs'
const OPENCODE_AUTH_FILE = '/home/node/.local/share/opencode/auth.json'

test('the image hands OpenAB the sign-in command and the credential path', () => {
  assert.match(dockerfile, /^ARG RUNTIME_LOGIN_COMMAND$/mu)
  assert.match(dockerfile, /^ARG RUNTIME_AUTH_FILE$/mu)
  assert.match(dockerfile, /^ENV OPENAB_RUNTIME_LOGIN_COMMAND="\$\{RUNTIME_LOGIN_COMMAND\}" \\$/mu)
  assert.match(dockerfile, /^ {4}OPENAB_RUNTIME_AUTH_FILE="\$\{RUNTIME_AUTH_FILE\}"$/mu)
})

test('each published image signs itself in and reports its own credential file', () => {
  assert.ok(build.includes(`LOGIN_COMMAND='${LOGIN_COMMAND}'`))
  assert.ok(build.includes(`AUTH_FILE='${AUTH_FILE}'`))
  assert.ok(build.includes(`LOGIN_COMMAND='${CLAUDE_LOGIN_COMMAND}'`))
  assert.ok(build.includes(`AUTH_FILE='${CLAUDE_AUTH_FILE}'`))
  assert.ok(build.includes(`LOGIN_COMMAND='${GROK_LOGIN_COMMAND}'`))
  assert.ok(build.includes(`AUTH_FILE='${GROK_AUTH_FILE}'`))
  assert.ok(build.includes(`LOGIN_COMMAND='${ANTIGRAVITY_LOGIN_COMMAND}'`))
  assert.ok(build.includes(`AUTH_FILE='${ANTIGRAVITY_AUTH_FILE}'`))
  assert.ok(build.includes(`LOGIN_COMMAND='${OPENCODE_LOGIN_COMMAND}'`))
  assert.ok(build.includes(`AUTH_FILE='${OPENCODE_AUTH_FILE}'`))
  assert.ok(!build.includes("AUTH_FILE=''"))
  assert.ok(build.includes('RUNTIME_LOGIN_COMMAND=${{ steps.tags.outputs.login_command }}'))
  assert.ok(build.includes('RUNTIME_AUTH_FILE=${{ steps.tags.outputs.auth_file }}'))
})

test('the image bakes the ACP environment a provisioned pod has always had', () => {
  // A self-hosted container reaching these by hand was the difference between a
  // runtime that chats with tools and one that accepts a session and then refuses
  // its first prompt. openab reads all four only as environment, so config.toml
  // cannot carry them.
  assert.match(dockerfile, /^ENV OPENAB_ACP_ENABLED=true \\$/mu)
  assert.match(dockerfile, /^ {4}OPENAB_ACP_MCP_SERVERS=true \\$/mu)
  assert.match(dockerfile, /^ {4}OPENAB_ACP_STREAMING=true \\$/mu)
  assert.match(dockerfile, /^ {4}GATEWAY_ALLOWED_USERS=acp_client( \\)?$/mu)
})

test('every agent runs in the workspace the image creates, never one without the other', () => {
  // openab ignores the cwd a client sends and spawns the agent in `working_dir`, which
  // defaults to $HOME — where no skill ever lands. The two halves are coupled: a
  // `working_dir` the image does not create fails every spawn with ENOENT, so a
  // runtime that sets one without the other cannot start an agent at all.
  for (const provider of ['claude-code', 'codex', 'grok', 'antigravity', 'opencode']) {
    const config = readFileSync(
      new URL(`../image/openab-config.${provider}.toml`, import.meta.url),
      'utf8',
    )

    // The [agent] table runs until the next line that opens another table.
    const agentTable = config.split(/^\[agent\]$/mu)[1]?.split(/^\[/mu)[0] ?? ''

    assert.match(agentTable, /^working_dir = "\/workspace"$/mu, provider)
  }
  assert.match(dockerfile, /^RUN install -d -o node -g node -m 755 \/workspace$/mu)
})

test('the password is the only variable an operator must set', () => {
  // Neither key is baked: the auth key is the operator's secret, and the operator key
  // is derived from it at start. A baked value for either would be the same secret in
  // every container.
  assert.doesNotMatch(dockerfile, /OPENAB_ACP_AUTH_KEY=/u)
  assert.doesNotMatch(dockerfile, /OPENAB_ACP_CONTROL_KEY=/u)
  // The derivation runs whatever command replaces the default, so it is part of the
  // entrypoint, with tini kept as PID 1 for signals and reaping.
  assert.match(
    dockerfile,
    /^ENTRYPOINT \["tini", "--", "\/usr\/local\/bin\/nuphos-runtime-start"\]$/mu,
  )
  assert.match(dockerfile, /^CMD \["openab", "run", "-c", "\/etc\/openab\/config\.toml"\]$/mu)
  // Nothing mounted means nothing at /workspace, and `node` cannot create it there.
  assert.match(dockerfile, /^RUN install -d -o node -g node -m 755 \/workspace$/mu)
})

test('the sign-in command names the flag that keeps the credential in the container', () => {
  // Without `--install` the credential rides the frame back to the caller, which is
  // the Kubernetes exec path's contract, not this one's.
  assert.ok(LOGIN_COMMAND.endsWith(' --install'))
  const login = readFileSync(new URL('../image/codex-login.mjs', import.meta.url), 'utf8')

  assert.ok(login.includes("process.argv.includes('--install')"))
})

test('the Claude Code sign-in helper ships in the image and writes where the agent reads', () => {
  assert.match(dockerfile, /^COPY codex-login\.mjs claude-login\.mjs /mu)
  assert.match(dockerfile, /test -r \/opt\/nuphos-runtime\/claude-login\.mjs/u)
  const login = readFileSync(new URL('../image/claude-login.mjs', import.meta.url), 'utf8')

  assert.ok(login.includes("join(home, '.claude', '.credentials.json')"))
  assert.ok(CLAUDE_AUTH_FILE.startsWith('/home/node/'))
})
