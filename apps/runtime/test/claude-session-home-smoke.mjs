// Exercise the pinned, patched adapter through new/load/resume up to its real
// SDK query handoff. Stop immediately before query() so no model or login is used.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('Claude new/load/resume isolate SDK and settings env while retaining runtime login', (t) => {
  const target = new URL(
    '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js',
    import.meta.url,
  )
  const instrumented = new URL(`./nuphos-home-smoke-${process.pid}.js`, target)
  const source = readFileSync(target, 'utf8')
  const anchor = '        const q = query({'
  assert.equal(source.split(anchor).length, 2)
  writeFileSync(
    instrumented,
    source.replace(
      anchor,
      `        throw Object.assign(new Error('captured-sdk-options'), { capturedOptions: options });\n${anchor}`,
    ),
  )
  const home = mkdtempSync(join(tmpdir(), 'nuphos-claude-home-smoke-'))
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
    import { ClaudeAcpAgent } from ${JSON.stringify(instrumented.href)};
    const agent = new ClaudeAcpAgent({ sessionUpdate: async () => {} }, { log() {}, error() {} });
    const captures = [];
    for (const [method, id] of [['newSession', 'a'], ['newSession', 'b'], ['loadSession', 'a'], ['resumeSession', 'a']]) {
      try {
        await agent[method]({ cwd: process.env.HOME, sessionId: 'native-session', mcpServers: [],
          _meta: { claudeCode: { options: {
            env: { NUPHOS_SESSION_ID: id, NUPHOS_TOKEN: 'synthetic' },
            settings: { env: { HOME: '/ambient-override', GH_CONFIG_DIR: '/shared-gh' } },
          } } } });
        throw new Error('SDK handoff not reached');
      } catch (error) {
        if (!error.capturedOptions) throw error;
        const { env, settings } = error.capturedOptions;
        captures.push({ home: env.HOME, gh: env.GH_CONFIG_DIR, login: env.CLAUDE_CONFIG_DIR,
          settingsHome: settings.env.HOME, settingsGh: settings.env.GH_CONFIG_DIR });
      }
    }
    console.log(JSON.stringify(captures));
    process.exit(0);
  `,
    ],
    {
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') },
      encoding: 'utf8',
      timeout: 30000,
    },
  )
  const [a, b, loaded, resumed] = JSON.parse(result.trim())
  assert.notEqual(a.home, home)
  assert.notEqual(a.home, b.home)
  assert.deepEqual(loaded, a)
  assert.deepEqual(resumed, a)
  for (const capture of [a, b]) {
    assert.equal(capture.settingsHome, capture.home)
    assert.equal(capture.settingsGh, capture.gh)
    assert.equal(capture.login, join(home, '.claude'))
  }
})
