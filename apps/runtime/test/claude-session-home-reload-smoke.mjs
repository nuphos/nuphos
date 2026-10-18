// A live Claude session must not outlive a change of session home. Drive the
// pinned, patched adapter's real getOrCreateSession with an existing session and
// stub only the SDK-facing create/teardown, so no model or login is used.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('Claude recreates a live session when the turn runs in another session home', (t) => {
  const target = new URL(
    '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js',
    import.meta.url,
  )
  const instrumented = new URL(`./nuphos-home-reload-smoke-${process.pid}.js`, target)
  writeFileSync(
    instrumented,
    `${readFileSync(target, 'utf8')}\nexport { computeSessionFingerprint as nuphosFingerprint };\n`,
  )
  const home = mkdtempSync(join(tmpdir(), 'nuphos-claude-reload-smoke-'))
  t.after(() => {
    rmSync(instrumented)
    rmSync(home, { recursive: true, force: true })
  })
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { ClaudeAcpAgent, nuphosFingerprint } from ${JSON.stringify(instrumented.href)};
    const agent = new ClaudeAcpAgent({ sessionUpdate: async () => {} }, { log() {}, error() {} });
    const calls = [];
    agent.teardownSession = async () => { calls.push('teardown') };
    agent.createSession = async (params, opts) => {
      calls.push('create');
      agent.sessions[opts.resume] = { sessionFingerprint: nuphosFingerprint(params), modes: {}, configOptions: [] };
      return { sessionId: opts.resume };
    };
    const turn = (actor) => ({ cwd: process.env.HOME, sessionId: 'live', mcpServers: [],
      _meta: { claudeCode: { options: { env: { NUPHOS_SESSION_ID: 'conv-1', NUPHOS_TOKEN: 'synthetic',
        ...(actor ? { NUPHOS_SESSION_ACTOR: actor } : {}) } } } } });
    const steps = [];
    // owner, owner again, a teammate (#453), the owner, automated work, automated again
    for (const actor of [null, null, 'teammate-2', null, 'automated', 'automated']) {
      calls.length = 0;
      await agent.getOrCreateSession(turn(actor));
      steps.push(calls.join('+') || 'reuse');
    }
    console.log(JSON.stringify(steps));
    process.exit(0);
  `,
    ],
    {
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') },
      encoding: 'utf8',
      timeout: 30000,
    },
  )

  assert.deepEqual(JSON.parse(result.trim()), [
    'create',
    'reuse',
    'teardown+create',
    'teardown+create',
    'teardown+create',
    'reuse',
  ])
})
