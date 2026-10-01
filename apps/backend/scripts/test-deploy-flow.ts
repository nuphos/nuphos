// E2E driver for the agent: simulates the renderer hitting /agent/chat with the
// cluster URL context, streams SSE, prints text + tool events, and (optionally)
// auto-replies with `ok` when the model asks for confirmation.
//
// Usage:
//   bun scripts/test-deploy-flow.ts [--no-auto-confirm] [--prompt "..."] [--once]

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import yaml from 'yaml'

import { applyEvent, looksLikeConfirmationAsk, shorten } from './test-deploy-flow-lib'

import type { AssistantPart } from './test-deploy-flow-lib'

const BACKEND = process.env.NUPHOS_BACKEND_URL_LOCAL ?? 'http://localhost:3717'

const TEAM_ID = '69e989027ab63e8d6a0ffcb6'
const GCP_PROJECT_ID = 'zeabur-byos-test-20260425'
const CLUSTER_NAME = 'zeabur-byos-test'
const REGION = 'us-west2-a'

const URL_CTX =
  `/teams/${TEAM_ID}/gcp/${GCP_PROJECT_ID}/clusters/${CLUSTER_NAME}` +
  `?region=${REGION}&view=workloads.pods`

const args = process.argv.slice(2)

function flag(name: string) {
  return args.includes(`--${name}`)
}
function arg(name: string): string | null {
  const idx = args.indexOf(`--${name}`)

  if (idx < 0) return null

  return args[idx + 1] ?? null
}

const AUTO_CONFIRM = !flag('no-auto-confirm')
const ONCE = flag('once')
const PROMPT = arg('prompt') ?? '幫我部署 Inngest 到這個集群'

function readToken(): string {
  const path = join(homedir(), '.config', 'zeabur', 'cli.yaml')
  const data = yaml.parse(readFileSync(path, 'utf8')) as { token?: string }

  if (!data.token) throw new Error('No token in cli.yaml')

  return data.token
}

type UIMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: Record<string, unknown>[]
}

const sessionId = randomUUID()
const token = readToken()
const messages: UIMessage[] = []

function pushUser(text: string) {
  messages.push({ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] })
}

async function sendTurn(
  prompt: string,
): Promise<{ assistantText: string; lastParts: AssistantPart[] }> {
  pushUser(prompt)

  const res = await fetch(`${BACKEND}/agent/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      accept: 'text/event-stream',
      'x-atlas-url': URL_CTX,
      'x-atlas-locale': 'zh-TW',
    },
    body: JSON.stringify({ id: sessionId, messages }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')

    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`)
  }
  if (!res.body) throw new Error('No body')

  let parts: AssistantPart[] = []
  let textSinceLastFlush = ''
  const reader = res.body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = ''

  process.stdout.write(`\n--- USER: ${prompt}\n--- ASSISTANT:\n`)
  while (true) {
    const { value, done } = await reader.read()

    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number

    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)

      buf = buf.slice(idx + 2)
      const dataLines: string[] = []

      for (const line of raw.split('\n')) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length === 0) continue
      const data = dataLines.join('\n')

      if (data === '[DONE]') continue
      let ev: any

      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      // Live print text + tool events
      if (ev.type === 'text-delta' && ev.delta) {
        process.stdout.write(ev.delta)
        textSinceLastFlush += ev.delta
      } else if (ev.type === 'tool-input-available') {
        process.stdout.write(`\n[tool→ ${ev.toolName} ${shorten(ev.input, 200)}]\n`)
      } else if (ev.type === 'tool-output-available') {
        process.stdout.write(`[tool← ${ev.toolCallId.slice(-6)} ok ${shorten(ev.output, 240)}]\n`)
      } else if (ev.type === 'tool-output-error') {
        process.stdout.write(
          `[tool← ${ev.toolCallId.slice(-6)} ERROR ${shorten(ev.errorText, 240)}]\n`,
        )
      } else if (ev.type === 'error') {
        process.stdout.write(`\n[STREAM ERROR ${shorten(ev.errorText, 400)}]\n`)
      }
      parts = applyEvent(parts, ev)
    }
  }
  process.stdout.write('\n')

  // Persist the assistant message in our local history
  messages.push({
    id: randomUUID(),
    role: 'assistant',
    parts: parts.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text }
      if (p.type === 'step-start') return { type: 'step-start' }

      return {
        type: `tool-${p.toolName}`,
        toolCallId: p.toolCallId,
        state: p.state,
        ...(p.input !== undefined ? { input: p.input } : {}),
        ...(p.output !== undefined ? { output: p.output } : {}),
        ...(p.errorText ? { errorText: p.errorText } : {}),
      }
    }),
  })

  return { assistantText: textSinceLastFlush, lastParts: parts }
}

async function main() {
  let nextPrompt: string | null = PROMPT
  let turn = 0

  while (nextPrompt) {
    turn++
    const { assistantText, lastParts } = await sendTurn(nextPrompt)

    if (ONCE) break

    // Decide whether to auto-confirm or stop
    const lastText = lastParts
      .filter((p) => p.type === 'text')
      .map((p) => (p as any).text)
      .join('\n')
    const hasRunningTool = lastParts.some(
      (p) => p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available'),
    )

    if (hasRunningTool) {
      console.error('\n[driver] tool left in non-terminal state — aborting')
      break
    }

    if (
      AUTO_CONFIRM &&
      (looksLikeConfirmationAsk(lastText) || looksLikeConfirmationAsk(assistantText))
    ) {
      console.error('\n[driver] auto-confirming (saying "ok, 請部署")')
      nextPrompt = 'ok，請部署，遇到需要決定的選項就用合理的預設值繼續'
    } else if (turn >= 8) {
      console.error('\n[driver] reached 8 turns, stopping')
      break
    } else {
      console.error('\n[driver] no confirmation prompt detected, stopping')
      break
    }
  }
  console.error(`\n[driver] done. session=${sessionId}`)
}

main().catch((e) => {
  console.error('[driver] FATAL', e)
  process.exit(1)
})
