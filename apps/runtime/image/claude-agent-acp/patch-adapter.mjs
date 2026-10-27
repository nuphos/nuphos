import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { patchPersonalSkillsRefresh, patchRuntimeDefaults } from '../runtime-defaults.mjs'
import { patchClaudeDefaultEffort } from './default-effort.mjs'
import { patchClaudeSessionState } from './session-state.mjs'
import { patchClaudeTurnCompletion } from './turn-completion.mjs'

const target = process.argv[2]
const source = readFileSync(target, 'utf8')
// The adapter resolves settings for its own choices (permission mode, model)
// separately from the query; it must read the same user-only sources.
const settingsTarget = new URL('settings.js', pathToFileURL(target))
const settingsCall = 'await resolveSettings({ cwd: this.cwd });'
const settingsSource = readFileSync(settingsTarget, 'utf8')
if (settingsSource.split(settingsCall).length !== 2)
  throw new Error('Expected one Claude adapter settings resolution.')
writeFileSync(
  settingsTarget,
  settingsSource.replace(
    settingsCall,
    'await resolveSettings({ cwd: this.cwd, settingSources: ["user"] });',
  ),
)
if (
  createHash('sha256').update(source).digest('hex') !==
  '0eeabe7242f82b2a27bd9a98c9812ff7fb29c4a67c1d289947b88bcacceb8548'
)
  throw new Error('Claude ACP bundle changed; review the Nuphos adapter patches.')
const mcpAnchor = '            for (const server of params.mcpServers) {'
if (source.split(mcpAnchor).length !== 2) throw new Error('Expected one Claude MCP server handoff.')
let patched = patchClaudeDefaultEffort(
  patchClaudeSessionState(patchClaudeTurnCompletion(source)),
).replace(
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
// Claude Code predicts the next user prompt a few seconds after each turn ends.
// The adapter drops it; forward it so the composer can offer it as ghost text.
const suggestionCase =
  '                    case "tool_use_summary":\n                    case "prompt_suggestion":\n                        break;'
const optionsAnchor = '            settingSources: ["user", "project", "local"],\n'
if (patched.split(suggestionCase).length !== 2 || patched.split(optionsAnchor).length !== 2)
  throw new Error('Expected one Claude prompt suggestion handoff.')
patched = patched
  .replace(
    optionsAnchor,
    '            settingSources: ["user"],\n            promptSuggestions: true,\n',
  )
  .replace(
    suggestionCase,
    `                    case "prompt_suggestion":
                        void this.client.sessionUpdate({
                            sessionId: params.sessionId,
                            update: { sessionUpdate: "session_info_update", _meta: {
                                "ai.nuphos/promptSuggestion": { suggestion: message.suggestion }
                            }}
                        }).catch((error) => this.logger.error("Could not publish prompt suggestion", error));
                        break;
                    case "tool_use_summary":
                        break;`,
  )
// Only user settings load; the working directory's CLAUDE.md is appended as text.
const instructionsAnchor =
  '        const permissionMode = resolvePermissionMode(settingsManager.getSettings().permissions?.defaultMode, this.logger);\n'
if (patched.split(instructionsAnchor).length !== 2)
  throw new Error('Expected one Claude system prompt handoff.')
patched = patched.replace(
  instructionsAnchor,
  `        systemPrompt = await nuphosWithProjectInstructions(systemPrompt, params.cwd);\n${instructionsAnchor}`,
)
// When Claude Code dies under the adapter (SIGABRT, OOM), the adapter deletes the
// session but keeps running. OpenAB judges an agent connection alive while its
// process runs, so it kept sending every later message to the deleted session.
// Exit instead: OpenAB keeps one adapter process per conversation, sees this one
// end, and the next message starts a fresh adapter that resumes the conversation
// through session/load. Exit after stdout drains, so the failed turn's error
// still reaches the gateway.
const processDied =
  '                delete this.sessions[params.sessionId];\n            }\n            else {\n                this.logger.error(`Session ${params.sessionId}: query stream error: ${message}`);'
if (patched.split(processDied).length !== 2)
  throw new Error('Expected one Claude process-death handoff.')
patched = patched.replace(
  processDied,
  processDied.replace(
    '                delete this.sessions[params.sessionId];\n',
    '                delete this.sessions[params.sessionId];\n                setImmediate(() => process.stdout.write("", () => process.exit(1)));\n',
  ),
)
// The turn's error names why Claude Code died (the memory limit, or its signal)
// instead of the adapter's generic "exited unexpectedly, start a new session".
const deathError =
  'failAllTurns(RequestError.internalError(undefined, "The Claude Agent process exited unexpectedly. Please start a new session."));'
if (patched.split(deathError).length !== 2)
  throw new Error('Expected one Claude process-death error.')
patched = patched.replace(
  deathError,
  'failAllTurns(RequestError.internalError(undefined, nuphosProcessDeathMessage(message)));',
)
const sessionHome = readFileSync(new URL('../session-home.mjs', import.meta.url), 'utf8')
const helper = readFileSync(new URL('../mcp-bridge-config.mjs', import.meta.url), 'utf8')
const instructions = readFileSync(new URL('./project-instructions.mjs', import.meta.url), 'utf8')
const processDeath = readFileSync(new URL('./process-death.mjs', import.meta.url), 'utf8')
patched = patchRuntimeDefaults(
  `${sessionHome}\n${helper}\n${instructions}\n${processDeath}\n${patched}`,
)
// A live session keeps its query, and with it the HOME it started in, until its
// fingerprint changes. Make the session home part of it, so a load for another
// actor (a teammate, or automated work) recreates the query in that actor's home
// instead of running in the previous one with its CLI logins.
const fingerprint = '    return JSON.stringify({ cwd: params.cwd, mcpServers: servers });'
if (patched.split(fingerprint).length !== 2)
  throw new Error('Expected one Claude session fingerprint.')
patched = patched.replace(
  fingerprint,
  `    const home = nuphosSessionHomeEnv(params._meta?.claudeCode?.options?.env ?? {}).NUPHOS_SESSION_HOME;
    return JSON.stringify({ cwd: params.cwd, mcpServers: servers, home });`,
)
for (const method of ['loadSession', 'resumeSession']) {
  const start = patched.indexOf(`async nuphos_${method}(params, nuphosRestorePhase) {`)
  const end = patched.indexOf('\n    async ', start + 1)
  const body = patched.slice(start, end)
  const setup = '        const result = await this.getOrCreateSession(params);'
  if (start < 0 || end < 0 || body.split(setup).length !== 2)
    throw new Error(`Expected one Claude ${method} restoration handoff.`)
  let traced = body.replace(
    setup,
    `        nuphosRestorePhase('sdk-session');\n${setup}${method === 'resumeSession' ? "\n        nuphosRestorePhase('publish-state');" : ''}`,
  )
  if (method === 'loadSession') {
    const replay = '        await this.replaySessionHistory(params.sessionId);'
    if (traced.split(replay).length !== 2) throw new Error('Expected one Claude history replay.')
    traced = traced.replace(
      replay,
      `        nuphosRestorePhase('history-replay');\n${replay}\n        nuphosRestorePhase('publish-state');`,
    )
  }
  traced = traced.replace('{\n', "{\n        nuphosRestorePhase('provider-update');\n")
  patched = patched.slice(0, start) + traced + patched.slice(end)
}
writeFileSync(target, patchPersonalSkillsRefresh(patched))
