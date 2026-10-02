import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { patchRuntimeDefaults } from '../runtime-defaults.mjs'
import { patchClaudeSessionState } from './session-state.mjs'
import { patchClaudeTurnCompletion } from './turn-completion.mjs'

const target = process.argv[2]
const source = readFileSync(target, 'utf8')
if (
  createHash('sha256').update(source).digest('hex') !==
  '0eeabe7242f82b2a27bd9a98c9812ff7fb29c4a67c1d289947b88bcacceb8548'
)
  throw new Error('Claude ACP bundle changed; review the Nuphos adapter patches.')
const mcpAnchor = '            for (const server of params.mcpServers) {'
if (source.split(mcpAnchor).length !== 2) throw new Error('Expected one Claude MCP server handoff.')
let patched = patchClaudeSessionState(patchClaudeTurnCompletion(source)).replace(
  mcpAnchor,
  '            for (const server of nuphosBridgeMcpServers(params.mcpServers)) {',
)
const envStart =
  '        const env = {\n            ...process.env,\n            ...userProvidedOptions?.env,'
const envEnd = '            CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",\n        };'
if (patched.split(envStart).length !== 2 || patched.split(envEnd).length !== 2)
  throw new Error('Expected one Claude SDK session environment handoff.')
patched = patched
  .replace(envStart, envStart.replace('const env = {', 'const env = nuphosClaudeSessionEnv({'))
  .replace(
    envEnd,
    envEnd.replace(
      '};',
      `}, userProvidedOptions?.env);
        // Settings env overrides the child environment in Claude Code. Pin the
        // session paths at the programmatic tier too, just like provider routing.
        if (env.NUPHOS_SESSION_HOME) {
            const sessionSettings = typeof settings === "string"
                ? JSON.parse(await fs.readFile(path.resolve(params.cwd, settings), "utf8"))
                : settings;
            settings = { ...sessionSettings, env: {
                ...sessionSettings?.env,
                ...nuphosSessionHomeEnv(userProvidedOptions?.env),
            } };
        }`,
    ),
  )
const sessionHome = readFileSync(new URL('../session-home.mjs', import.meta.url), 'utf8')
const helper = readFileSync(new URL('../mcp-bridge-config.mjs', import.meta.url), 'utf8')
writeFileSync(target, patchRuntimeDefaults(`${sessionHome}\n${helper}\n${patched}`))
