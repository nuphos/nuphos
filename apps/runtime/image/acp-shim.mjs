#!/usr/bin/env node
// The Nuphos layer for agents that ship their own ACP server (Grok Build, Google
// Antigravity, OpenCode, Hermes Agent, DeepSeek Harness, Cursor), and for Pi behind the pi-acp
// adapter. Claude Code and Codex get this layer by patching their Node adapters;
// a native binary cannot be patched, so this process sits in front of it instead and
// passes every frame through, except where a Nuphos session needs something:
//
// - The conversation's environment. OpenAB starts one agent process per session, so
//   the agent is respawned once with the session's env and CLI home before its first
//   session/new, load or resume. The agent's own login stays in the runtime home.
//   A Cursor agent OpenAB keeps warm for the next session takes the env in place instead.
// - The team's skills, the runtime defaults and the MCP credential bridge, exactly as
//   the patched adapters apply them.
// - Nuphos's instructions, in whatever form the agent accepts them.
import { execFileSync, spawn } from 'node:child_process'
import { lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { hermesProfile } from './hermes-session.mjs'
import { nuphosBridgeMcpServers } from './mcp-bridge-config.mjs'
import { openCodeEndpoint, openCodeRefusal } from './opencode-session.mjs'
import { piAgentDir, piTurnError, writePiMcpServers } from './pi-session.mjs'
import { nuphosProcessDeathMessage } from './process-death.mjs'
import { nuphosApplyRuntimeDefaults, nuphosSyncRuntimeSkills } from './runtime-defaults.mjs'
import { nuphosSessionHomeEnv } from './session-home.mjs'

export const SESSION_META = 'ai.nuphos/session'
// The env OpenAB gives a session's process at spawn, sent here when it hands the session a
// process it started earlier (`[pool] prewarm`).
export const SPAWN_ENV_META = 'ai.nuphos/spawnEnv'
const ADOPT_PRELOAD = new URL('./agent-adopt.mjs', import.meta.url).href

// Same principal-scoped keys the Codex adapter forwards; nothing else in the
// session's env reaches the agent.
const SESSION_ENV = new Set([
  'NUPHOS_TOKEN',
  'NUPHOS_BACKEND_URL',
  'NUPHOS_TEAM_ID',
  'TEAM',
  'NUPHOS_SESSION_ID',
  'NUPHOS_SESSION_ACTOR',
  'NUPHOS_SESSION_HOME_EPOCH',
  'NUPHOS_PLAN_API_BASE',
  'NUPHOS_PLAN_API_TOKEN',
  // The backend clears these for a selected connector, so the runtime's own do
  // not beat it. Codex needs none of them: its shells inherit nothing.
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'GH_TOKEN',
  'GITHUB_TOKEN',
])

export const PROVIDERS = {
  grok: {
    name: 'Grok Build',
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
    name: 'Antigravity',
    command: (env) => [
      'agy',
      'acp',
      '--process-per-session',
      '--gemini-dir',
      join(env.NUPHOS_AGENT_HOME, '.gemini'),
    ],
    home: (runtimeHome) => ({ NUPHOS_AGENT_HOME: runtimeHome }),
    // Reuse the existing first-prompt instruction path.
    instruct: null,
    // Keep separate Nuphos turns separate: native ACP treats overlapping prompts as steering.
    serialPrompts: true,
  },
  opencode: {
    name: 'OpenCode',
    command: ['opencode', 'acp'],
    home: () => ({ OPENCODE_DISABLE_AUTOUPDATE: '1' }),
    // OpenCode keeps its login (auth.json) and its sessions in XDG_DATA_HOME/opencode,
    // and provider settings such as Bedrock's region in XDG_CONFIG_HOME/opencode. Only
    // those directories are shared with the runtime home; the rest of the XDG
    // directories stays the conversation's own, as for every other tool.
    shared: [join('.local', 'share', 'opencode'), join('.config', 'opencode')],
    // No system prompt parameter over ACP: the instructions lead the first prompt.
    instruct: null,
    // A prompt sent while a turn runs joins that turn instead of starting its own.
    serialPrompts: true,
    // A refused turn never ends on its own: see opencode-session.mjs.
    refusal: true,
  },
  hermes: {
    name: 'Hermes Agent',
    command: ['hermes', 'acp'],
    // A profile, and so a background daemon, of the session home's own: see hermes-session.mjs.
    home: (runtimeHome, sessionHome) => ({
      HERMES_HOME: hermesProfile(runtimeHome, sessionHome ?? runtimeHome),
    }),
    // Hermes reads no _meta: the instructions lead the first prompt.
    instruct: null,
    serialPrompts: true,
  },
  dsh: {
    name: 'DeepSeek Harness',
    command: ['dsh', '--profile', 'acp'],
    // Its login (.credentials.yaml), profiles and sessions, in the runtime home.
    home: (runtimeHome) => ({ DSH_HOME: join(runtimeHome, '.dsh') }),
    instruct: null,
    serialPrompts: true,
    // DSH resumes a session without replaying it, and has no session/load; OpenAB only
    // loads, so a load is sent as a resume.
    loadAsResume: true,
  },
  cursor: {
    name: 'Cursor',
    // `cursor-agent`, not its shorter name `agent`, which other CLIs also install.
    command: ['cursor-agent', 'acp'],
    // Its login as a file (cursor-login.mjs), not in a keychain every home shares.
    home: () => ({ AGENT_CLI_CREDENTIAL_STORE: 'file' }),
    // The login and settings: ~/.cursor on macOS, ~/.config/cursor elsewhere.
    shared: ['.cursor', join('.config', 'cursor')],
    instruct: null,
    serialPrompts: true,
    // Its first session/new in a process waits seconds on Cursor's backend, the next ones do not.
    warm: true,
  },
  pi: {
    name: 'Pi',
    // Pi speaks its own RPC, not ACP: pi-acp, installed beside this file, runs the CLI.
    adapter: true,
    command: [
      process.execPath,
      fileURLToPath(new URL('./node_modules/pi-acp/dist/index.js', import.meta.url)),
    ],
    // An agent directory of the session home's own: see pi-session.mjs.
    home: (runtimeHome, sessionHome, runtimeEnv) => ({
      PI_CODING_AGENT_DIR: piAgentDir(runtimeHome, sessionHome ?? runtimeHome),
      PI_ACP_PI_COMMAND: runtimeEnv.NUPHOS_AGENT_EXECUTABLE || 'pi',
    }),
    // pi-acp passes a session's MCP servers nowhere; Pi reads them from its agent directory.
    mcpServers: (env, servers) => writePiMcpServers(env.PI_CODING_AGENT_DIR, servers),
    // pi-acp ends a failed turn as if Pi had replied; Pi's session file says why it failed.
    turnError: (env, sessionId) => piTurnError(env.PI_CODING_AGENT_DIR, sessionId),
    instruct: null,
    serialPrompts: true,
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
  const sessionHome = nuphosSessionHomeEnv(env, runtimeEnv)
  if (sessionHome.NUPHOS_SESSION_HOME)
    for (const path of PROVIDERS[provider].shared ?? [])
      shareFromRuntimeHome(path, sessionHome.NUPHOS_SESSION_HOME, runtimeHome)
  // The provider's home is pinned to the runtime's, after the session home moves HOME.
  return {
    ...runtimeEnv,
    ...env,
    ...sessionHome,
    ...PROVIDERS[provider].home(runtimeHome, sessionHome.NUPHOS_SESSION_HOME, runtimeEnv),
  }
}

/** Links `path` in the conversation's home to the same path in the runtime's home. */
function shareFromRuntimeHome(path, sessionHome, runtimeHome) {
  const link = join(sessionHome, path)
  mkdirSync(join(runtimeHome, path), { recursive: true, mode: 0o700 })
  mkdirSync(dirname(link), { recursive: true, mode: 0o700 })
  try {
    lstatSync(link)
    return
  } catch {}
  try {
    // A junction on Windows, where a symlink needs Developer Mode or an administrator.
    symlinkSync(join(runtimeHome, path), link, 'junction')
  } catch (error) {
    // Unshared, the agent starts without the runtime's login there; the turn still runs.
    process.stderr.write(
      `nuphos: could not share ${path} with the runtime home: ${error.message}\n`,
    )
  }
}

// The lifecycle the backend reads for every agent, as the Claude adapter is patched
// to report it: active while a turn runs, idle once it ends. A turn the agent starts
// on its own (a Grok scheduler wakeup) opens and closes with it too.
const TURN_OPENERS = new Set([
  'user_message_chunk',
  'agent_thought_chunk',
  'agent_message_chunk',
  'tool_call',
])

export function sessionState(sessionId, state) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'session_info_update',
        _meta: { 'ai.nuphos/sessionState': { state } },
      },
    },
  }
}

function toolUpdate(sessionId, toolCallId, status, meta) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: { sessionUpdate: 'tool_call_update', toolCallId, status, _meta: meta },
    },
  }
}

// The agent and every process under it, by name and age only: never their arguments.
export function processTree(
  root,
  list = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,comm='], { encoding: 'utf8' }),
) {
  let rows
  try {
    rows = list()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length >= 4)
      .map(([pid, ppid, age, ...name]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        age,
        name: basename(name.join(' ')),
      }))
  } catch {
    return undefined
  }
  const tree = rows.filter((row) => row.pid === root)
  for (let i = 0; i < tree.length; i++) tree.push(...rows.filter((row) => row.ppid === tree[i].pid))
  return tree
}

export function instructionsBlock(text) {
  return { type: 'text', text: `<nuphos-instructions>\n${text}\n</nuphos-instructions>` }
}

export function runShim({
  provider,
  input = process.stdin,
  output = process.stdout,
  runtimeEnv = process.env,
  spawnAgent = (command, env, handoff) =>
    spawn(command[0], command.slice(1), {
      env,
      stdio: ['pipe', 'pipe', 'inherit', ...(handoff ? ['pipe'] : [])],
      windowsHide: true,
    }),
  platform = process.platform,
  onExit = (code) => process.exit(code),
  // How long a prompt's answer gets to close its turn upstream before the
  // turn the agent started next is released.
  settleMs = 1000,
  // How often an open turn checks whether its provider refused it (spec.refusal), once
  // the agent has sent nothing for the session for `refusalQuietMs`.
  refusalPollMs = 1500,
  refusalQuietMs = 15_000,
  readOpenCodeRefusal = openCodeRefusal,
  // Where a turn the agent has gone quiet in is described, and after how long (#4521).
  log = (line) => process.stderr.write(`acp-shim: ${line}\n`),
  stallLogMs = 300_000,
  stallCheckMs = 60_000,
  listProcesses,
}) {
  const spec = PROVIDERS[provider]
  if (!spec) throw new Error(`Unknown ACP provider: ${String(provider)}`)
  const write = (message) => output.write(`${JSON.stringify(message)}\n`)
  const pendingInstructions = new Map()
  // session/prompt ids in flight, by session, and the sessions running a turn the
  // agent started on its own.
  const prompts = new Map()
  const autonomous = new Set()
  // Sessions being loaded or resumed: the history the agent replays is not a turn.
  const opening = new Set()
  // A prompt's turn can end before its answer reaches the client, and a wakeup can
  // start in between; until the answer, the session's later updates wait here.
  const held = new Map()
  const queued = new Map()
  // Grok's background commands, by task: shown as the running terminal of the
  // tool that started them until the task itself reports how it ended.
  const tasks = new Map()
  const internal = new Map()
  const transforms = new Map()
  // Why each prompt's provider refused it; the agent's answer to the cancel closes them.
  const refused = new Map()
  // When the agent last sent anything for each session.
  const heard = new Map()
  const activityVersion = new Map()
  const sessionDirectories = new Map()
  // The last frames each way and the open tool calls, structure only, for a turn that stalls.
  const frames = []
  const tools = new Map()
  const stalled = new Set()
  const trace = (from, message) => {
    const update = message.params?.update
    frames.push({
      at: Date.now(),
      from,
      method: message.method ?? 'response',
      kind: update?.sessionUpdate,
      toolCallId: update?.toolCallId,
      status: update?.status,
    })
    if (frames.length > 20) frames.shift()
  }
  let initialize
  let agent
  let agentEnvironment
  let agentEndpoint
  let pendingInitialize
  let restarting
  // The session home the agent was last started in; null until a session binds it.
  let boundHome = null
  let nextId = 0
  // A warm agent's channel for the session's env (agent-adopt.mjs), until a session takes it.
  let handoff
  // The throwaway session that warms it: true until the agent names it. Its updates are dropped.
  let warmSession
  let warming

  const start = async (env, withoutStatus = false) => {
    const previous = agent

    agent = undefined
    previous?.kill('SIGTERM')
    let endpoint
    if (provider === 'opencode' && !withoutStatus) {
      try {
        endpoint = await openCodeEndpoint()
      } catch {
        // A missing status endpoint must not prevent an otherwise normal turn.
      }
    }
    const originalEnv = env

    if (endpoint) env = { ...env, OPENCODE_SERVER_PASSWORD: endpoint.password }
    // A computer running the agent locally names its own CLI, which may be off PATH.
    const [command, ...args] = typeof spec.command === 'function' ? spec.command(env) : spec.command
    // An adapter runs the CLI itself, named to it in its home's environment.
    const executable = spec.adapter ? command : env.NUPHOS_AGENT_EXECUTABLE || command
    // Only the agent OpenAB starts ahead of a session, before anyone initialized it.
    const warm =
      spec.warm && !initialize && runtimeEnv.NUPHOS_PREWARM === '1' && platform !== 'win32'
    const child = spawnAgent(
      endpoint
        ? [executable, ...args, '--hostname', '127.0.0.1', '--port', String(endpoint.port)]
        : [executable, ...args],
      warm
        ? {
            ...env,
            NODE_OPTIONS: [env.NODE_OPTIONS, `--import ${ADOPT_PRELOAD}`].filter(Boolean).join(' '),
            NUPHOS_ADOPT_FD: '3',
          }
        : env,
      warm,
    )
    handoff = warm ? child.stdio[3] : undefined
    agent = child
    agentEnvironment = env
    agentEndpoint = endpoint
    // The agent is the session: when it ends, so does this process.
    let initialized = false
    child.on('exit', (code, signal) => {
      if (agent !== child) return
      if (endpoint && !initialized) {
        const retry = pendingInitialize

        restarting = start(originalEnv, true).then(() => {
          if (retry && pendingInitialize === retry) send(retry)
        })
        void restarting.catch(() => onExit(code ?? 1))
        return
      }
      if (!signal) return onExit(code ?? 1)
      // Killed (the memory limit, most often): the turns in flight fail with the reason,
      // as Claude Code's and Codex's do, before the output closes.
      const reason = nuphosProcessDeathMessage(spec.name, `process terminated by signal ${signal}`)
      for (const id of prompts.keys())
        write({ jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${reason}` } })
      output.write('', () => onExit(1))
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (agent !== child) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return output.write(`${line}\n`)
      }
      if (pendingInitialize && message.id === pendingInitialize.id && !message.method) {
        initialized = true
        pendingInitialize = undefined
      }
      fromAgent(message)
    })
  }
  const forward = (message) => {
    const isResponse = message.id !== undefined && message.method === undefined
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
  }
  const prompting = (sessionId) => [...prompts.values()].includes(sessionId)
  const fromAgent = (message) => {
    const sessionId = message.params?.sessionId
    if (sessionId && (warmSession === true || sessionId === warmSession)) return
    if (sessionId) {
      heard.set(sessionId, Date.now())
      activityVersion.set(sessionId, (activityVersion.get(sessionId) ?? 0) + 1)
    }
    const kind = message.params?.update?.sessionUpdate
    if (message.method && held.has(sessionId)) return void held.get(sessionId).push(message)
    trace('agent', message)
    stalled.delete(sessionId)
    if (message.method === undefined && prompts.has(message.id)) {
      const promptSession = prompts.get(message.id)
      prompts.delete(message.id)
      // Cancelled by this process for its provider's refusal, or a refusal the agent ended as
      // if it had replied.
      const failure =
        refused.get(message.id) ??
        (message.result && spec.turnError?.(agentEnvironment, promptSession))
      refused.delete(message.id)
      // A failed turn answers as Claude Code's does, so every client shows why it failed.
      forward(
        failure
          ? {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: `Internal error: The model provider refused the request: ${failure}`,
              },
            }
          : message,
      )
      const next = queued.get(promptSession)?.shift()
      if (next) sendPrompt(next)
      else queued.delete(promptSession)
      if (!prompting(promptSession)) write(sessionState(promptSession, 'idle'))
      const later = held.get(promptSession)
      if (later)
        setTimeout(() => {
          held.delete(promptSession)
          for (const update of later) fromAgent(update)
        }, settleMs)
      return
    }
    if (kind === 'task_backgrounded') {
      const update = message.params.update
      tasks.set(update.task_id, update.tool_call_id)
      return write(
        toolUpdate(sessionId, update.tool_call_id, 'in_progress', {
          terminal_info: { terminalId: update.task_id, command: update.command },
        }),
      )
    }
    if (kind === 'task_completed') {
      const task = message.params.update.task_snapshot ?? {}
      const toolCallId = tasks.get(task.task_id)
      if (!toolCallId) return forward(message)
      tasks.delete(task.task_id)
      return write(
        toolUpdate(sessionId, toolCallId, task.exit_code === 0 ? 'completed' : 'failed', {
          terminal_info: { terminalId: task.task_id },
          ...(typeof task.output === 'string' ? { terminal_output: task.output } : {}),
          terminal_exit: { exitCode: task.exit_code ?? null, signal: task.signal ?? null },
        }),
      )
    }
    // The tool only started the command; it runs until the task completes.
    const toolCallId = message.params?.update?.toolCallId
    if (
      kind === 'tool_call_update' &&
      message.params.update.status === 'completed' &&
      [...tasks.values()].includes(toolCallId)
    )
      message = {
        ...message,
        params: { ...message.params, update: { ...message.params.update, status: 'in_progress' } },
      }
    const status = message.params?.update?.status
    if (kind === 'tool_call')
      tools.set(toolCallId, { kind: message.params.update.kind, started: Date.now() })
    if ((status === 'completed' || status === 'failed') && tools.has(toolCallId)) {
      const tool = tools.get(toolCallId)
      tools.delete(toolCallId)
      log(
        `tool_call ${String(toolCallId)} kind=${String(tool.kind)} ${status} after ${String(Date.now() - tool.started)}ms`,
      )
    }
    if (kind === 'turn_completed' && autonomous.delete(sessionId)) {
      write(message)
      return write(sessionState(sessionId, 'idle'))
    }
    if (kind === 'turn_completed' && prompting(sessionId)) held.set(sessionId, [])
    // Output no prompt asked for opens a turn the agent started on its own: a
    // wakeup's reminder, its first thought or text, or a new tool. A tool update
    // alone is a background command reporting, not a turn.
    if (
      TURN_OPENERS.has(kind) &&
      !opening.has(sessionId) &&
      !prompting(sessionId) &&
      !autonomous.has(sessionId)
    ) {
      autonomous.add(sessionId)
      write(sessionState(sessionId, 'active'))
    }
    forward(message)
  }
  const send = (message) => {
    if (message.method === 'initialize') pendingInitialize = message
    agent.stdin.write(`${JSON.stringify(message)}\n`)
  }
  const watchRefusal = (id, sessionId) => {
    heard.set(sessionId, Date.now())
    let checking = false
    const timer = setInterval(async () => {
      if (prompts.get(id) !== sessionId) return clearInterval(timer)
      // A turn the agent is still answering is not refused.
      if (checking || Date.now() - heard.get(sessionId) < refusalQuietMs) return
      checking = true
      const lastHeard = heard.get(sessionId)
      const lastActivity = activityVersion.get(sessionId)
      const checkedAgent = agent
      let why
      try {
        why = await readOpenCodeRefusal(agentEndpoint, sessionId, sessionDirectories.get(sessionId))
      } catch {
        // Whatever cannot be read leaves the turn as it is.
      } finally {
        checking = false
      }
      if (
        !why ||
        prompts.get(id) !== sessionId ||
        agent !== checkedAgent ||
        heard.get(sessionId) !== lastHeard ||
        activityVersion.get(sessionId) !== lastActivity
      )
        return
      clearInterval(timer)
      refused.set(id, why)
      send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    }, refusalPollMs)
    timer.unref?.()
  }
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `nuphos-shim-${String(++nextId)}`
      internal.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      )
      send({ jsonrpc: '2.0', id, method, params })
    })

  // Gives the warm agent the session's env and cwd; false when it cannot take them.
  const adopt = async (env, cwd) => {
    const channel = handoff
    handoff = undefined
    if (!channel) return false
    await warming
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      channel.once('data', () => {
        clearTimeout(timer)
        agentEnvironment = env
        resolve(true)
      })
      channel.on('error', () => {})
      channel.once('close', () => resolve(false))
      channel.write(`${JSON.stringify({ env, cwd })}\n`)
    })
  }

  const openSession = async (message) => {
    const context = sessionContext(message.params)
    const { [SPAWN_ENV_META]: spawnEnv, ...openMeta } = message.params?._meta ?? {}
    // This process's own, which its credential bridge and skill sync read.
    if (spawnEnv) Object.assign(runtimeEnv, spawnEnv)
    const env = context?.env || spawnEnv ? agentEnv(provider, context, runtimeEnv) : undefined
    if (env && (spawnEnv || (env.NUPHOS_SESSION_HOME ?? '') !== boundHome)) {
      // The agent runs under the runtime's own env (a warmed one under the pool's), or
      // the previous actor's when a teammate now acts in the conversation; restart it
      // under this one's before it opens the session. The client already holds the
      // initialize answer.
      boundHome = env.NUPHOS_SESSION_HOME ?? ''
      if (!(await adopt(env, message.params?.cwd))) {
        await start(env)
        if (restarting) await restarting
        if (initialize) await request('initialize', initialize.params)
      }
    }
    await nuphosSyncRuntimeSkills(message.params)
    let meta = openMeta
    const text = typeof context?.systemPrompt === 'string' ? context.systemPrompt : ''
    if (text && spec.instruct) meta = spec.instruct(meta, text)
    const params = {
      ...message.params,
      _meta: meta,
      mcpServers: nuphosBridgeMcpServers(message.params?.mcpServers ?? [], runtimeEnv),
    }
    spec.mcpServers?.(agentEnvironment, params.mcpServers)
    if (params.sessionId) opening.add(params.sessionId)
    transforms.set(message.id, async (reply) => {
      opening.delete(params.sessionId)
      if (reply.error) return reply
      // A loaded or resumed session gets the current instructions too.
      const sessionId = reply.result?.sessionId ?? params.sessionId
      if (sessionId && typeof params.cwd === 'string') sessionDirectories.set(sessionId, params.cwd)
      if (text && !spec.instruct) pendingInstructions.set(sessionId, text)
      const agentApi = {
        setSessionConfigOption: (options) => request('session/set_config_option', options),
      }
      return {
        ...reply,
        result: await nuphosApplyRuntimeDefaults(agentApi, { ...params, sessionId }, reply.result),
      }
    })
    send({ ...message, params })
  }

  const handle = async (message) => {
    trace('client', message)
    if (restarting) await restarting
    if (message.method === 'initialize') {
      // OpenAB offers to run terminals itself, in the gateway's environment rather
      // than this session's. The agent runs its own commands, as Claude and Codex do.
      const params = message.params ?? {}
      message = {
        ...message,
        params: {
          ...params,
          clientCapabilities: { ...params.clientCapabilities, terminal: false },
        },
      }
      initialize = message
      // The warm agent opens its throwaway session as soon as it is initialized.
      if (handoff)
        transforms.set(message.id, async (reply) => {
          if (reply.error) return reply
          warmSession = true
          warming = request('session/new', { cwd: process.cwd(), mcpServers: [] }).then(
            (result) => (warmSession = result?.sessionId),
            () => (warmSession = undefined),
          )
          return reply
        })
      if (spec.loadAsResume)
        transforms.set(message.id, async (reply) => {
          const capabilities = reply.result?.agentCapabilities
          if (!capabilities) return reply
          return {
            ...reply,
            result: {
              ...reply.result,
              agentCapabilities: { ...capabilities, loadSession: true },
            },
          }
        })
    }
    if (spec.loadAsResume && message.method === 'session/load')
      message = { ...message, method: 'session/resume' }
    if (['session/new', 'session/load', 'session/resume'].includes(message.method))
      return openSession(message)
    const sessionId = message.params?.sessionId
    if (message.method === 'session/cancel') {
      // A stop also ends the prompts waiting behind the one it cancels.
      for (const waiting of queued.get(sessionId) ?? [])
        write({ jsonrpc: '2.0', id: waiting.id, result: { stopReason: 'cancelled' } })
      queued.delete(sessionId)
    }
    if (message.method !== 'session/prompt') return send(message)
    if (spec.serialPrompts && prompting(sessionId)) {
      if (!queued.has(sessionId)) queued.set(sessionId, [])
      return void queued.get(sessionId).push(message)
    }
    sendPrompt(message)
  }
  const sendPrompt = (message) => {
    const sessionId = message.params.sessionId
    prompts.set(message.id, sessionId)
    heard.set(sessionId, Date.now())
    if (spec.refusal) watchRefusal(message.id, sessionId)
    write(sessionState(sessionId, 'active'))
    const text = pendingInstructions.get(sessionId)
    pendingInstructions.delete(sessionId)
    send(
      text
        ? {
            ...message,
            params: {
              ...message.params,
              prompt: [instructionsBlock(text), ...message.params.prompt],
            },
          }
        : message,
    )
  }

  // A prompt the agent has said nothing about for `stallLogMs`: what it was last doing.
  setInterval(() => {
    const now = Date.now()
    for (const sessionId of new Set(prompts.values())) {
      if (stalled.has(sessionId) || now - heard.get(sessionId) < stallLogMs) continue
      stalled.add(sessionId)
      const quiet = {
        quietMs: now - heard.get(sessionId),
        openToolCalls: [...tools].map(([id, tool]) => ({
          id,
          kind: tool.kind,
          ms: now - tool.started,
        })),
        lastFrames: frames.map(({ at, ...frame }) => ({ ...frame, ago: now - at })),
        processes: agent && processTree(agent.pid, listProcesses),
      }
      log(`turn quiet: ${JSON.stringify(quiet)}`)
    }
  }, stallCheckMs).unref?.()

  // Frames are handled in order: a prompt must not overtake the session it belongs to.
  let queue = start(agentEnv(provider, undefined, runtimeEnv))
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
