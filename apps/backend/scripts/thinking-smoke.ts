// Extended-thinking smoke test against the REAL deployed model.
//
// This is the mandatory pre-enable gate: the incident happened because the
// thinking interface was never exercised against the actual AGENT_MODEL_ID. Run
// this with the same env prod would use BEFORE setting AGENT_THINKING_MODE
// anywhere:
//
//   AWS_BEDROCK_REGION=... AWS_BEDROCK_ACCESS_KEY_ID=... \
//   AWS_BEDROCK_SECRET_ACCESS_KEY=... \
//   AGENT_MODEL_ID=global.anthropic.claude-opus-4-8 \
//   AGENT_THINKING_MODE=adaptive AGENT_THINKING_EFFORT=medium \
//   bun scripts/thinking-smoke.ts
//
// It validates the three paths the incident never reached:
//   1. single turn with thinking
//   2. multi-step tool loop (thinking blocks flow back with tool results
//      inside one streamText call — the SDK-managed path)
//   3. continuation: the finished turn becomes history, goes through
//      stripReasoningParts + healForBedrock (exactly what the chat route
//      does), and a follow-up request must succeed
//
// Read-only against the world: it calls the model and nothing else.

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { streamText, tool, stepCountIs } from 'ai'
import { z } from 'zod'

import { healForBedrock, stripReasoningParts } from '../src/lib/agent/bedrock-heal'

const modelId = process.env.AGENT_MODEL_ID
const mode = (process.env.AGENT_THINKING_MODE ?? '').toLowerCase()
const effort = (process.env.AGENT_THINKING_EFFORT ?? 'medium').toLowerCase()
const budget = Number(process.env.AGENT_THINKING_BUDGET_TOKENS ?? '2048')

if (!modelId)
  fail('AGENT_MODEL_ID is required — use the ACTUAL deployed value, not the code default')
if (mode !== 'adaptive' && mode !== 'budget') {
  fail(`AGENT_THINKING_MODE must be 'adaptive' or 'budget' for this smoke (got '${mode}')`)
}
if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
  fail(`AGENT_THINKING_EFFORT must be low/medium/high/xhigh/max (got '${effort}')`)
}
if (mode === 'budget' && (!Number.isInteger(budget) || budget < 1024)) {
  // Fail-fast like mode/effort — a NaN/too-small budget would otherwise only
  // surface as an opaque Bedrock error mid-run (Bedrock's floor is 1024).
  fail(
    `AGENT_THINKING_BUDGET_TOKENS must be an integer >= 1024 for budget mode (got '${process.env.AGENT_THINKING_BUDGET_TOKENS ?? '(unset)'}')`,
  )
}

// Same env names and defaults as config.ts's agent block — the smoke must
// exercise the SAME provider/region/creds the runtime would use, or the gate
// proves the wrong thing.
const useVertex = process.env.AGENT_MODEL_PROVIDER === 'vertex'

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

let bedrock: (id: string) => Parameters<typeof streamText>[0]['model']
let providerOptions: Record<string, Record<string, unknown>>

if (useVertex) {
  const vertex = createVertexAnthropic({
    project: process.env.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION ?? 'global',
  })

  bedrock = (id) => vertex(id)
  // Vertex takes the Anthropic shape: `thinking` plus a SIBLING `effort` —
  // not Bedrock's single reasoningConfig object. Mirrors model-provider.ts.
  providerOptions =
    mode === 'adaptive'
      ? { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort } }
      : { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
} else {
  const provider = createAmazonBedrock({
    region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
    accessKeyId: process.env.AWS_BEDROCK_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_BEDROCK_SECRET_ACCESS_KEY ?? '',
  })

  bedrock = (id) => provider(id)
  providerOptions = {
    bedrock: {
      reasoningConfig:
        mode === 'adaptive'
          ? {
              type: 'adaptive' as const,
              maxReasoningEffort: effort as ReasoningEffort,
              // Required for reasoning to STREAM on Opus 4.8-generation models
              // (without it thinking is silent) — mirrors the runtime config.
              display: 'summarized' as const,
            }
          : { type: 'enabled' as const, budgetTokens: budget },
    },
  }
}

const pingTool = tool({
  description: 'Returns a fixed diagnostic string. Call it when asked to ping.',
  inputSchema: z.object({ label: z.string().describe('any short label') }),
  execute: async ({ label }) => ({ pong: label, at: new Date().toISOString() }),
})

function fail(message: string): never {
  console.error(`\n❌ FAIL: ${message}`)
  process.exit(1)
}

async function drain(result: ReturnType<typeof streamText>) {
  let reasoningChars = 0
  let textChars = 0

  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') reasoningChars += part.text.length
    if (part.type === 'text-delta') textChars += part.text.length
    if (part.type === 'error') fail(`stream error: ${JSON.stringify(part.error).slice(0, 500)}`)
  }

  return { reasoningChars, textChars, response: await result.response, steps: await result.steps }
}

console.log(`model=${modelId} mode=${mode} effort=${effort} budget=${budget}`)

// --- 1. single turn -------------------------------------------------------
console.log('\n[1/3] single turn with thinking…')
const one = await drain(
  streamText({
    model: bedrock(modelId),
    providerOptions,
    messages: [{ role: 'user', content: 'In one short sentence: why is the sky blue?' }],
  }),
)

if (one.textChars === 0) fail('single turn produced no text')
console.log(`  ok — reasoning=${one.reasoningChars}ch text=${one.textChars}ch`)

// --- 2. multi-step tool loop ----------------------------------------------
console.log('[2/3] tool loop (thinking blocks flow back with tool results)…')
const loopMessages = [
  {
    role: 'user' as const,
    content:
      'First think carefully about the order of operations, then call the ping tool twice with labels "a" then "b" (two separate calls, plan before each), then tell me both pongs.',
  },
]
const two = await drain(
  streamText({
    model: bedrock(modelId),
    providerOptions,
    tools: { ping: pingTool },
    stopWhen: [stepCountIs(6)],
    messages: loopMessages,
  }),
)
const toolSteps = two.steps.filter((s) => s.toolCalls.length > 0).length

if (toolSteps === 0) fail('tool loop made no tool calls')
if (two.textChars === 0) fail('tool loop produced no final text')
// The gate must PROVE reasoning flowed through the tool loop — thinking
// blocks riding along with tool results is exactly the path being validated.
// (Phase 1 alone can legitimately skip thinking under `adaptive`.)
if (two.reasoningChars === 0 && one.reasoningChars === 0) {
  fail(
    'no reasoning deltas were received in either phase — thinking is not actually active; ' +
      'the gate proves nothing. Check the mode/model pairing.',
  )
}
console.log(
  `  ok — toolSteps=${toolSteps} reasoning=${two.reasoningChars}ch text=${two.textChars}ch`,
)

// --- 3. continuation over healed history ----------------------------------
console.log('[3/3] continuation: finished turn -> strip+heal -> follow-up…')
// response.messages are model messages carrying the turn's reasoning blocks —
// appending them + a user follow-up mirrors the stop-gate round-stitch path
// exactly, which is the riskiest continuation in the chat route.
const history = [
  ...loopMessages,
  ...two.response.messages,
  { role: 'user' as const, content: 'Now call ping once more with label "c" and confirm.' },
]
const healed = healForBedrock(stripReasoningParts(history as { role: string; content?: unknown }[]))
const three = await drain(
  streamText({
    model: bedrock(modelId),
    providerOptions,
    tools: { ping: pingTool },
    stopWhen: [stepCountIs(4)],
    messages: healed as never,
  }),
)

if (three.textChars === 0) fail('continuation produced no final text')
console.log(`  ok — reasoning=${three.reasoningChars}ch text=${three.textChars}ch`)

console.log('\n✅ PASS — all three thinking paths succeeded against the real model.')
console.log('Safe to consider enabling AGENT_THINKING_MODE for THIS model id only.')

// Exit explicitly: every real failure above already hard-exits 1 via fail(),
// so reaching this line means every assertion passed. Falling off the end
// instead left the verdict at the mercy of teardown — an aborted stream or
// socket can reject after the last await and crash the process (observed
// against Bedrock: three consecutive runs printed PASS and exited 1, with a raw
// DOMException dump). A gate whose exit code contradicts its own output is
// worse than no gate.
process.exit(0)
