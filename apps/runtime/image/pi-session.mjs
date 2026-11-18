// Pi keeps everything it has in its agent directory: its login (auth.json), its settings,
// its sessions and the MCP servers it connects to (mcp.json). pi-acp passes the session's
// MCP servers nowhere, so they are written to that file, and they hold this conversation's
// credentials. So each session home, that is each conversation and each teammate acting
// in it, gets an agent directory of its own.
//
// It signs in with the root's login (~/.pi/agent/auth.json) and starts on the model the
// sign-in chose, which is copied from the root's settings.
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** The settings a sign-in writes: the model every conversation starts on. */
export const MODEL_SETTINGS = ['defaultProvider', 'defaultModel']

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export function writeJson(file, value) {
  const temporary = `${file}.${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, file)
}

/** Prepares the agent directory for `sessionHome` and returns it (PI_CODING_AGENT_DIR). */
export function piAgentDir(runtimeHome, sessionHome, workspace = process.cwd()) {
  const root = join(runtimeHome, '.pi', 'agent')
  const dir = join(sessionHome, '.pi', 'agent')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // The login and the user's own model providers, as the sign-in last left them: copied,
  // as Windows links files only for administrators.
  if (dir !== root)
    for (const name of ['auth.json', 'models.json']) {
      rmSync(join(dir, name), { force: true })
      try {
        copyFileSync(join(root, name), join(dir, name))
      } catch {
        // None yet.
      }
    }
  const chosen = readJson(join(root, 'settings.json'))
  writeJson(join(dir, 'settings.json'), {
    ...(dir === root ? chosen : {}),
    ...Object.fromEntries(
      MODEL_SETTINGS.filter((key) => typeof chosen[key] === 'string').map((key) => [
        key,
        chosen[key],
      ]),
    ),
    // pi-acp sends the startup listing as the agent's first message otherwise.
    quietStartup: true,
    enableInstallTelemetry: false,
    // A workspace's own extensions and settings never load: no terminal is there to ask.
    defaultProjectTrust: 'never',
    skills: [join(workspace, '.agents', 'skills')],
  })
  return dir
}

// Pi reads `$NAME` in these values as an environment variable and a leading `!` as a command
// to run; a session's values are taken as they are.
export const literal = (value) => {
  const escaped = String(value).replace(/\$/gu, () => '$$')
  return escaped.startsWith('!') ? `$${escaped}` : escaped
}

const pairs = (values) =>
  Object.fromEntries((values ?? []).map(({ name, value }) => [name, literal(value)]))

/** Writes a session's ACP MCP servers as the mcp.json Pi reads when it starts. */
export function writePiMcpServers(agentDir, servers = []) {
  const mcpServers = Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        ...(server.url
          ? { url: server.url, headers: pairs(server.headers) }
          : { command: server.command, args: server.args ?? [], env: pairs(server.env) }),
        // Offered as tools of their own, as every other agent offers them.
        exposure: 'direct',
      },
    ]),
  )
  writeJson(join(agentDir, 'mcp.json'), { mcpServers })
}

// Providers echo part of a rejected key (OpenAI: `sk-proj-****abcd`), and the error is
// shown to everyone in the conversation.
const KEY = /\b(?:(?:sk|pk|rk)[-_]|xai-|gsk_|hf_|nvapi-|AIza)[\w*-]{4,}|\bBearer\s+\S+/gu

export const redactKeys = (text) => text.replace(KEY, '[redacted]')

/**
 * Why a session's last turn failed, as Pi recorded it, or undefined. pi-acp drops the
 * error a provider answered with (a rejected key, a spent quota) and ends the turn as if
 * it had replied, so the answer is read from the session file Pi keeps.
 */
export function piTurnError(agentDir, sessionId) {
  const sessions = join(agentDir, 'sessions')
  try {
    for (const folder of readdirSync(sessions)) {
      const name = readdirSync(join(sessions, folder)).find((file) =>
        file.endsWith(`_${sessionId}.jsonl`),
      )
      if (!name) continue
      // The last message, not the last line: after a prompt over the model's context Pi
      // appends a context_edit that takes the error out of what it sends next time.
      const { message } = readFileSync(join(sessions, folder, name), 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
        .findLast((entry) => entry.type === 'message')
      return message?.role === 'assistant' && message.stopReason === 'error'
        ? redactKeys(String(message.errorMessage || 'The model provider returned an error.'))
        : undefined
    }
  } catch {
    return undefined
  }
  return undefined
}
