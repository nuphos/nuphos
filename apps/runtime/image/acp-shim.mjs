#!/usr/bin/env node
// The Nuphos layer for agents that ship their own ACP server (Grok Build, Google
// Antigravity). Claude Code and Codex get this layer by patching their Node adapters;
// a native binary cannot be patched, so this process sits in front of it instead and
// passes every frame through, except where a Nuphos session needs something:
//
// - The conversation's environment. OpenAB starts one agent process per session, so
//   the agent is respawned once with the session's env and CLI home before its first
//   session/new, load or resume. The agent's own login stays in the runtime home.
// - The team's skills, the runtime defaults and the MCP credential bridge, exactly as
//   the patched adapters apply them.
// - Nuphos's instructions, in whatever form the agent accepts them.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import { nuphosBridgeMcpServers } from './mcp-bridge-config.mjs'
import { nuphosApplyRuntimeDefaults, nuphosSyncRuntimeSkills } from './runtime-defaults.mjs'
import { nuphosSessionHomeEnv } from './session-home.mjs'

export const SESSION_META = 'ai.nuphos/session'

// Same principal-scoped keys the Codex adapter forwards; nothing else in the
// session's env reaches the agent.
const SESSION_ENV = new Set([
  'NUPHOS_TOKEN',
  'NUPHOS_BACKEND_URL',
  'NUPHOS_TEAM_ID',
  'TEAM',
  'NUPHOS_SESSION_ID',
  'NUPHOS_PLAN_API_BASE',
  'NUPHOS_PLAN_API_TOKEN',
])

export const PROVIDERS = {
  grok: {
    // --no-leader keeps tools in this process, so they run with this session's env
    // rather than in a leader shared by every conversation.
    command: ['grok', 'agent', '--no-leader', 'stdio'],
    home: (runtimeHome) => ({
      GROK_HOME: join(runtimeHome, '.grok'),
      GROK_DISABLE_AUTOUPDATER: '1',
    }),
    // Appended to Grok's own system prompt.
    instruct: (meta, text) => ({ ...meta, rules: text }),
  },
  antigravity: {
    command: ['agy-acp-server'],
    home: (runtimeHome) => ({ GEMINI_HOME: join(runtimeHome, '.gemini') }),
    // No system prompt parameter: the instructions lead the session's first prompt.
    instruct: null,
    // Its timers hold the prompt open until they fire, and a recurring one never
    // lets the turn end. Nuphos schedules work itself.
    sessionMeta: { agy: { disabledTools: ['schedule'] } },
  },
}

export function sessionContext(params) {
  const context = params?._meta?.[SESSION_META]
  return context && typeof context === 'object' ? context : undefined
}

export function agentEnv(provider, context, runtimeEnv = process.env) {
  const runtimeHome = runtimeEnv.HOME || homedir()
  const env = Object.fromEntries(
    Object.entries(context?.env ?? {}).filter(
      ([key, value]) => SESSION_ENV.has(key) && typeof value === 'string',
    ),
  )
  // The provider's home is pinned to the runtime's, after the session home moves HOME.
  return {
    ...runtimeEnv,
    ...env,
    ...nuphosSessionHomeEnv(env, runtimeEnv),
    ...PROVIDERS[provider].home(runtimeHome),
  }
}

// The end-of-turn marker the backend reads for a turn the agent started on its
// own (Claude reports one per wakeup). Grok ends such turns only with its own
// `_x.ai/session/update`, which nothing upstream understands.
export function autonomousTurnEnd(sessionId) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'usage_update',
        _meta: { '_claude/origin': { kind: 'task-notification' } },
      },
    },
  }
}

export function instructionsBlock(text) {
  return { type: 'text', text: `<nuphos-instructions>\n${text}\n</nuphos-instructions>` }
}

export function runShim({
  provider,
  input = process.stdin,
  output = process.stdout,
  runtimeEnv = process.env,
  spawnAgent = (command, env) =>
    spawn(command[0], command.slice(1), { env, stdio: ['pipe', 'pipe', 'inherit'] }),
  onExit = (code) => process.exit(code),
}) {
  const spec = PROVIDERS[provider]
  if (!spec) throw new Error(`Unknown ACP provider: ${String(provider)}`)
  const write = (message) => output.write(`${JSON.stringify(message)}\n`)
  const pendingInstructions = new Map()
  // session/prompt ids in flight, by session, and the sessions running a turn the
  // agent started on its own: one opens with a user message no prompt carried.
  const prompts = new Map()
  const autonomous = new Set()
  const internal = new Map()
  const transforms = new Map()
  let initialize
  let agent
  let bound = false
  let nextId = 0

  const start = (env) => {
    agent?.kill('SIGTERM')
    const child = spawnAgent(spec.command, env)
    agent = child
    // The agent is the session: when it ends, so does this process.
    child.on('exit', (code) => {
      if (agent === child) onExit(code ?? 1)
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (agent !== child) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return output.write(`${line}\n`)
      }
      const isResponse = message.id !== undefined && message.method === undefined
      if (isResponse) prompts.delete(message.id)
      const updateSession = message.params?.sessionId
      const kind = message.params?.update?.sessionUpdate
      if (kind === 'user_message_chunk' && ![...prompts.values()].includes(updateSession))
        autonomous.add(updateSession)
      if (kind === 'turn_completed' && autonomous.delete(updateSession)) {
        write(message)
        return write(autonomousTurnEnd(updateSession))
      }
      if (isResponse && internal.has(message.id)) {
        const settle = internal.get(message.id)
        internal.delete(message.id)
        return settle(message)
      }
      if (isResponse && transforms.has(message.id)) {
        const transform = transforms.get(message.id)
        transforms.delete(message.id)
        return void transform(message).then(write, (error) =>
          write({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: error.message },
          }),
        )
      }
      write(message)
    })
  }
  const send = (message) => agent.stdin.write(`${JSON.stringify(message)}\n`)
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `nuphos-shim-${String(++nextId)}`
      internal.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      )
      send({ jsonrpc: '2.0', id, method, params })
    })

  const openSession = async (message) => {
    const context = sessionContext(message.params)
    if (!bound && context?.env) {
      // The agent answered initialize under the runtime's own env; give it this
      // session's before it opens one. The client already holds that answer.
      bound = true
      start(agentEnv(provider, context, runtimeEnv))
      if (initialize) await request('initialize', initialize.params)
    }
    await nuphosSyncRuntimeSkills(message.params)
    let meta = { ...message.params?._meta, ...spec.sessionMeta }
    const text = typeof context?.systemPrompt === 'string' ? context.systemPrompt : ''
    if (text && spec.instruct) meta = spec.instruct(meta, text)
    const params = {
      ...message.params,
      _meta: meta,
      mcpServers: nuphosBridgeMcpServers(message.params?.mcpServers ?? [], runtimeEnv),
    }
    transforms.set(message.id, async (reply) => {
      if (reply.error) return reply
      // A loaded or resumed session gets the current instructions too.
      const sessionId = reply.result?.sessionId ?? params.sessionId
      if (text && !spec.instruct) pendingInstructions.set(sessionId, text)
      if (message.method !== 'session/new') return reply
      const agentApi = {
        setSessionConfigOption: (options) => request('session/set_config_option', options),
      }
      return {
        ...reply,
        result: await nuphosApplyRuntimeDefaults(agentApi, params, reply.result),
      }
    })
    send({ ...message, params })
  }

  const handle = async (message) => {
    if (message.method === 'initialize') initialize = message
    if (['session/new', 'session/load', 'session/resume'].includes(message.method))
      return openSession(message)
    const sessionId = message.params?.sessionId
    if (message.method === 'session/prompt') prompts.set(message.id, sessionId)
    if (message.method === 'session/prompt' && pendingInstructions.has(sessionId)) {
      const text = pendingInstructions.get(sessionId)
      pendingInstructions.delete(sessionId)
      return send({
        ...message,
        params: { ...message.params, prompt: [instructionsBlock(text), ...message.params.prompt] },
      })
    }
    send(message)
  }

  start(agentEnv(provider, undefined, runtimeEnv))
  // Frames are handled in order: a prompt must not overtake the session it belongs to.
  let queue = Promise.resolve()
  createInterface({ input }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    queue = queue.then(() =>
      handle(message).catch((error) => {
        if (message.id !== undefined)
          write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } })
      }),
    )
  })
  input.on('end', () => agent?.stdin.end())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShim({ provider: process.argv[2] })
}
