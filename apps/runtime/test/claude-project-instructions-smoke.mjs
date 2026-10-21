// A working directory others can write must not run anything in the next
// session: only user settings load, and its CLAUDE.md reaches the model as text.
// Drives the pinned, patched adapter to its SDK options, then runs the real SDK
// query with them against a local stub API, so no model or login is used.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const target = new URL(
  '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js',
  import.meta.url,
)
const sdk = new URL(
  '../image/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
  import.meta.url,
)

function project(root, name, claudeMd) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude'), { recursive: true })
  claudeMd(join(dir, 'CLAUDE.md'))
  const touch = (marker) => ({ type: 'command', command: `touch ${join(root, marker)}` })
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      env: { PLANTED_ENV: 'planted' },
      hooks: {
        SessionStart: [{ hooks: [touch('hook-ran')] }],
        UserPromptSubmit: [{ hooks: [touch('hook-ran')] }],
      },
    }),
  )
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({
      mcpServers: { planted: { command: 'touch', args: [join(root, 'mcp-ran')] } },
    }),
  )

  return dir
}

test('project settings stay off; the working directory CLAUDE.md is appended as text', (t) => {
  const instrumented = new URL(`./nuphos-instructions-smoke-${process.pid}.js`, target)
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
  const root = mkdtempSync(join(tmpdir(), 'nuphos-claude-instructions-'))
  t.after(() => {
    rmSync(instrumented)
    rmSync(root, { recursive: true, force: true })
  })
  const home = join(root, 'home')
  mkdirSync(home)
  const plain = project(root, 'plain', (file) =>
    writeFileSync(file, 'MAGIC_PROJECT_WORD=zebra-41\n'),
  )
  writeFileSync(join(root, 'elsewhere.md'), 'MAGIC_LINKED_WORD=okapi-17\n')
  const linked = project(root, 'linked', (file) => symlinkSync(join(root, 'elsewhere.md'), file))

  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createServer } from 'node:http';
    import { ClaudeAcpAgent } from ${JSON.stringify(instrumented.href)};
    import { query } from ${JSON.stringify(sdk.href)};
    const requests = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push(body);
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'stub' } }));
      });
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const agent = new ClaudeAcpAgent({ sessionUpdate: async () => {} }, { log() {}, error() {} });
    const out = {};
    for (const [name, cwd] of [['plain', ${JSON.stringify(plain)}], ['linked', ${JSON.stringify(linked)}]]) {
      let options;
      try {
        await agent.newSession({ cwd, mcpServers: [], _meta: { claudeCode: { options: {
          env: { NUPHOS_SESSION_ID: name, NUPHOS_TOKEN: 'synthetic' } } } } });
      } catch (error) {
        if (!error.capturedOptions) throw error;
        options = error.capturedOptions;
      }
      out[name] = { settingSources: options.settingSources, append: options.systemPrompt?.append ?? '' };
      if (name !== 'plain') continue;
      // The real SDK with exactly these options, pointed at the stub.
      const env = { ...options.env, ANTHROPIC_API_KEY: 'sk-ant-stub',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.address().port,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
      const q = query({ prompt: 'hi', options: { cwd, env, settingSources: options.settingSources,
        systemPrompt: options.systemPrompt, maxTurns: 1 } });
      try { for await (const _ of q) {} } catch {}
      out.requests = { count: requests.length,
        claudeMd: requests.some((body) => body.includes('zebra-41')),
        plantedEnv: requests.some((body) => body.includes('PLANTED_ENV')) };
    }
    server.close();
    console.log(JSON.stringify(out));
    process.exit(0);
  `,
    ],
    {
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') },
      encoding: 'utf8',
      timeout: 120000,
    },
  )
  const out = JSON.parse(result.trim().split('\n').at(-1))

  assert.deepEqual(out.plain.settingSources, ['user'])
  assert.match(out.plain.append, /MAGIC_PROJECT_WORD=zebra-41/)
  assert.ok(out.requests.count > 0, 'the SDK reached the stub API')
  assert.ok(out.requests.claudeMd, 'CLAUDE.md reached the model')
  assert.equal(out.requests.plantedEnv, false)
  assert.equal(existsSync(join(root, 'hook-ran')), false, 'a project hook ran')
  assert.equal(existsSync(join(root, 'mcp-ran')), false, 'a project MCP server started')
  // A symlinked CLAUDE.md cannot pull in a file from outside the directory.
  assert.doesNotMatch(out.linked.append, /okapi-17/)
})
