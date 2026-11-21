// Deterministic model substitute, behind the real OpenAB executable and ACP transport.
// No network tools, GitHub credentials, or real inference are used.
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import { nuphosApplyRuntimeDefaults } from '../../apps/runtime/image/runtime-defaults.mjs'

import { formSteps } from './acp-fixture-form.mjs'
import { askSteps } from './fixture-ask.mjs'
import { answerChannel } from './fixture-channel.mjs'
import { scriptedUpdates } from './fixture-commands.mjs'
import { hop, inherit } from './fixture-hop.mjs'
import {
  call,
  callNamed,
  confirmWork,
  personalToken,
  recheck,
  reporting,
  setToolsServer,
  subtask,
} from './fixture-mcp.mjs'
import { applySetting, heldDefaults, longReply, turnFacts } from './fixture-settings.mjs'
import { INITIALIZE, opening } from './fixture-session.mjs'
import { retune } from './fixture-retune.mjs'
import { refuse } from './fixture-turn-refusals.mjs'
import { CLAUDE_TURN_QUOTA, CLAUDE_TURN_USAGE } from './fixture-usage.mjs'

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
// Every entry names the agent host it ran on, which is what tells two runtimes apart.
const log = (entry) =>
  appendFileSync(
    process.env.E2E_ACP_LOG,
    `${JSON.stringify({ agent: process.env.E2E_AGENT, ...entry })}\n`,
  )

// A prompt containing E2E_HOLD stays in its turn until the client cancels it.
const held = new Map()
// Requests this agent made of its client, waiting for their answers. OpenAB reads ids as numbers.
const asked = new Map()
let nextRequest = 1_000_000
// The thread E2E_THREAD started last, for E2E_POKE to message.
let thread

const refused = (message) => Boolean(message.error ?? message.result?.isError)
const step = reporting(send)

const form = formSteps({ call: step, log, refused })
const ask = askSteps({ call: step, log, refused })

// A delegated turn names its sender by title, which carries the sender's own
// markers, so the fixture tells such a turn by its prompt and does not delegate again.
const CHILD = 'Child task'

/** Starts a sub-agent on an agent other than this one, in fast mode when asked. */
async function delegate(sessionId, fast) {
  const listed = await call(sessionId, 'list_agent_runtimes', { label: 'List the agents' })
  const other = listed.result?.structuredContent?.runtimes?.find((runtime) => !runtime.current)
  const start = (prompt, speed) =>
    call(sessionId, 'create_thread', {
      label: 'Delegate to another agent',
      title: 'E2E child',
      prompt,
      runtimeId: other?.runtimeId,
      ...(speed ? { fast: speed } : {}),
    })
  const detail = (message) => message.error?.message ?? message.result?.content?.[0]?.text
  const message = await start(
    `${CHILD} E2E_DELIVERY:${fast ? 'child-fast' : 'child'}`,
    fast && 'on',
  )

  log({ sessionId, event: 'delegated', isError: refused(message), detail: detail(message) })
  // A speed the agent does not offer is refused, and the refusal names the ones it does.
  if (fast) log({ sessionId, event: 'refused', detail: detail(await start(CHILD, 'warp')) })
}

/** Starts a thread that asks for a permission, then tries to move it to Auto Mode on its own. */
async function startThread(sessionId, marker) {
  const started = await call(sessionId, 'create_thread', {
    label: 'Start a thread',
    title: 'E2E thread',
    prompt: 'Run a command E2E_PERMISSION E2E_DELIVERY:thread',
  })

  thread = /threadId[\\"]*:[\\"]*([0-9a-f-]{36})/.exec(JSON.stringify(started))?.[1]
  const change = await call(sessionId, 'update_thread', {
    label: 'Move the thread to Auto Mode',
    threadId: thread,
    fullAccess: false,
  })

  log({ sessionId, marker, event: refused(change) ? 'thread-mode-refused' : 'thread-mode-changed' })
}

/** Asks the client to allow a command, as a runtime does before it runs one. */
async function permission(sessionId, marker) {
  const id = nextRequest++
  const answered = new Promise((resolve) => asked.set(id, resolve))

  log({ sessionId, marker, event: 'permission-asked' })
  send({
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId: randomUUID(), title: 'echo e2e', kind: 'execute', status: 'pending' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  })
  const outcome = (await answered)?.outcome

  log({ sessionId, marker, event: `permission-${outcome?.optionId ?? outcome?.outcome ?? 'none'}` })
}

// Sessions whose answer the first agent refuses as out of usage (#3055).
const late = new Set()

async function prompt({ sessionId, prompt: parts }) {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const markers = text.match(/E2E_DELIVERY:[a-z0-9-]+/g) ?? []
  const marker = markers.at(-1) ?? 'E2E_DELIVERY:missing'

  log({ sessionId, marker, markers, event: 'start', ...turnFacts(text) })
  // #3051, #3055: the first agent refuses this prompt, or an E2E_ASK_LATE answer, as out of usage.
  if (text.includes('E2E_ASK_LATE')) late.add(sessionId)
  const outOfUsage =
    text.includes('E2E_USAGE_LIMIT') || (late.has(sessionId) && !text.includes('E2E_ASK'))

  refuse(text, outOfUsage && process.env.E2E_AGENT !== 'second')
  // Nuphos tells the agent when a person dismisses its question.
  if (text.includes('was dismissed by')) log({ sessionId, marker, event: 'dismissed' })
  if (text.includes('E2E_DELEGATE') && !text.includes(CHILD)) {
    await delegate(sessionId, text.includes('E2E_DELEGATE_FAST'))
  }
  await form(sessionId, text)
  // A thread started here, then moved (E2E_HOP), or left on this session's model (E2E_INHERIT).
  if (/E2E_(HOP|INHERIT)/.test(text) && !text.includes(CHILD))
    await (text.includes('E2E_HOP') ? hop : inherit)({ call, send, log, sessionId, child: CHILD })
  if (text.includes('E2E_RETUNE') && !text.includes(CHILD))
    await retune({ call, step, log, sessionId, child: CHILD })
  if (text.includes('E2E_SUBTASK')) await subtask({ log, sessionId, marker })
  if (text.includes('E2E_ASK')) await ask(sessionId, text)
  // A Bot is woken by its chat's posts and answers there, as only channel_post can.
  const channelId = /\(channelId ([^)]+)\)/.exec(text)?.[1]

  if (channelId) await answerChannel({ call, log, sessionId, channelId, text })
  if (process.env.E2E_BOT_ONBOARDING && text.includes('The person just created you'))
    await ask(sessionId, 'preference')
  if (text.includes('E2E_ONBOARDING_COMPLETE')) {
    const result = await call(sessionId, 'update_self', {
      label: 'Save confirmed responsibilities',
      instructions:
        'Review release notes for the project and prepare a weekly summary. Ask before publishing.',
      onboardingComplete: true,
    })

    log({
      sessionId,
      event: 'onboarding-complete',
      isError: refused(result),
      detail: JSON.stringify(result.result),
    })
  }
  // The thread's own prompt can carry its parent's words; only the parent starts one.
  if (text.includes('E2E_THREAD') && !text.includes('E2E_PERMISSION')) {
    await startThread(sessionId, marker)
  }
  if (text.includes('E2E_POKE')) {
    await call(sessionId, 'send_message_to_thread', {
      label: 'Message the thread',
      threadId: thread,
      prompt: 'Run it again E2E_PERMISSION E2E_DELIVERY:thread-again',
    })
  }
  if (text.includes('E2E_PERMISSION')) await permission(sessionId, marker)
  scriptedUpdates({ send, sessionId, text })
  if (text.includes('E2E_CALL')) await callNamed({ log, sessionId, text })
  if (text.includes('E2E_ACK_WORK')) await confirmWork({ log, sessionId, marker, text })
  if (text.includes('E2E_PERSONAL_TOKEN')) await personalToken({ log, sessionId, marker, text })
  // Answers only once the scenario writes E2E_RELEASE (else `release` beside the ACP log, in
  // the artifacts), so a turn can span what it does meanwhile.
  if (text.includes('E2E_WAIT_RELEASE')) {
    const release = process.env.E2E_RELEASE ?? join(dirname(process.env.E2E_ACP_LOG), 'release')

    while (!existsSync(release)) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (text.includes('E2E_RECHECK')) await recheck({ log, sessionId })
  if (text.includes('E2E_HOLD')) {
    await new Promise((resolve) => held.set(sessionId, resolve))
    log({ sessionId, marker, event: 'cancelled' })

    return { stopReason: 'cancelled' }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  send({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `ACK ${marker}${longReply(text)}` },
      },
    },
  })
  log({ sessionId, marker, event: 'finish' })

  return text.includes('E2E_TURN_USAGE')
    ? { stopReason: 'end_turn', usage: CLAUDE_TURN_USAGE, _meta: { quota: CLAUDE_TURN_QUOTA } }
    : { stopReason: 'end_turn' }
}

async function answer(request) {
  switch (request.method) {
    case 'initialize':
      return INITIALIZE
    case 'session/new': {
      const sessionId = randomUUID()

      log({ event: 'opening' })
      // A slow agent start: the session does not open while this file exists.
      while (existsSync(process.env.E2E_HOLD_OPENING)) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      setToolsServer(
        sessionId,
        request.params.mcpServers?.find(({ name }) => name === 'nuphos-tools'),
      )

      // The settings the conversation was created with, applied by the runtime's own code,
      // which refuses to open a session on a value this agent does not offer.
      const defaults = request.params._meta?.['ai.nuphos/runtimeDefaults'] ?? {}
      const agent = {
        setSessionConfigOption: async ({ configId, value }) => ({
          configOptions: applySetting(sessionId, configId, value),
        }),
      }

      log({ sessionId, event: 'session', defaults, ...opening(request.params) })

      return nuphosApplyRuntimeDefaults(agent, heldDefaults(sessionId, request.params), {
        sessionId,
        configOptions: applySetting(sessionId),
      })
    }
    case 'session/prompt':
      return prompt(request.params)
    case 'session/load':
      // A restarted host loads the session with its tools again, as it opened it.
      setToolsServer(
        request.params.sessionId,
        request.params.mcpServers?.find(({ name }) => name === 'nuphos-tools'),
      )
      log({ sessionId: request.params.sessionId, event: 'loaded', ...opening(request.params) })

      return {}
    case 'session/set_mode':
      return {}
    case 'session/set_config_option': {
      const { sessionId, configId, value } = request.params

      return { configOptions: applySetting(sessionId, configId, value, log) }
    }
    default:
      throw new Error(`Unsupported fixture method: ${request.method}`)
  }
}

// Requests are answered as they finish, not in order: a held prompt must not
// keep the cancel that ends it from being read.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)

  // An answer to a request of this agent's own.
  if (request.method === undefined) {
    asked.get(request.id)?.(request.result)
    asked.delete(request.id)
    continue
  }
  if (request.method === 'session/cancel') {
    held.get(request.params.sessionId)?.()
    held.delete(request.params.sessionId)
  }
  if (request.id === undefined) continue
  answer(request).then(
    (result) => send({ id: request.id, result }),
    (error) =>
      send({ id: request.id, error: { code: error.code ?? -32601, message: error.message } }),
  )
}
