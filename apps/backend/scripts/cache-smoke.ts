// Prompt-cache smoke test against the REAL model (zeabur/nuphos#407).
//
// Proves the moving trailing cache breakpoint (applyTrailingCachePoint)
// produces cache READS — specifically the two behaviors that unit tests cannot
// prove:
//   1. within one tool loop, after the checkpoint moves forward a step, the
//      previous step's cache entry still HITS (read grows, noCache stays small)
//   2. a follow-up request (history rebuilt route-style via stripReasoningParts
//      + healForBedrock, checkpoint on the new tail) re-reads the prior
//      conversation from cache
//
// Run with the same env prod uses:
//
//   AWS_BEDROCK_REGION=... AWS_BEDROCK_ACCESS_KEY_ID=... \
//   AWS_BEDROCK_SECRET_ACCESS_KEY=... \
//   AGENT_MODEL_ID=global.anthropic.claude-opus-5 \
//   bun scripts/cache-smoke.ts
//
// Or against Vertex, where the breakpoint has a different shape entirely and
// so needs its own proof (auth is Application Default Credentials):
//
//   AGENT_MODEL_PROVIDER=vertex GOOGLE_VERTEX_PROJECT=... \
//   GOOGLE_VERTEX_LOCATION=global AGENT_MODEL_ID=claude-opus-5 \
//   bun scripts/cache-smoke.ts
//
// Read-only against the world: it calls the model and nothing else. Costs a
// few cents (the system prompt is padded past the minimum cacheable prefix,
// ~4k tokens for Opus).

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { streamText, tool, stepCountIs } from 'ai'
import { z } from 'zod'

import {
  applyTrailingCachePoint,
  BEDROCK_CACHE_POINT,
  healForBedrock,
  stripReasoningParts,
  VERTEX_CACHE_POINT,
} from '../src/lib/agent/bedrock-heal'

import type { LanguageModelUsage, ModelMessage } from 'ai'

const modelId = process.env.AGENT_MODEL_ID

if (!modelId) fail('AGENT_MODEL_ID is required — use the ACTUAL deployed value')

const useVertex = process.env.AGENT_MODEL_PROVIDER === 'vertex'
const cachePoint = useVertex ? VERTEX_CACHE_POINT : BEDROCK_CACHE_POINT

let model: (id: string) => Parameters<typeof streamText>[0]['model']

if (useVertex) {
  const vertex = createVertexAnthropic({
    project: process.env.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION ?? 'global',
  })

  model = (id) => vertex(id)
} else {
  const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY

  if (!accessKeyId || !secretAccessKey)
    fail('AWS_BEDROCK_ACCESS_KEY_ID and AWS_BEDROCK_SECRET_ACCESS_KEY are required')
  const bedrock = createAmazonBedrock({
    region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
    accessKeyId,
    secretAccessKey,
  })

  model = (id) => bedrock(id)
}

function fail(message: string): never {
  console.error(`\nFAIL: ${message}`)
  process.exit(1)
}

// Deterministic filler so the cacheable prefix clears Bedrock's minimum
// (~4k tokens for Opus). Deterministic content = byte-identical prefix
// across the two requests in phase 2.
const filler = Array.from(
  { length: 400 },
  (_, i) =>
    `Rule ${i}: diagnostic fixture line ${i} — respond concisely, prefer tools over prose, never fabricate output.`,
).join('\n')
const systemPrompt = `You are a smoke-test agent. Follow the rules below.\n\n${filler}`

const pingTool = tool({
  description: 'Returns a fixed diagnostic string. Call it when asked to ping.',
  inputSchema: z.object({ label: z.string().describe('any short label') }),
  execute: async ({ label }) => ({ pong: label, at: 'fixed-timestamp' }),
})

const fmt = (u: LanguageModelUsage) =>
  `noCache=${u.inputTokenDetails.noCacheTokens ?? 0} cRead=${u.inputTokenDetails.cacheReadTokens ?? 0} cWrite=${u.inputTokenDetails.cacheWriteTokens ?? 0}`

const systemMessages = [
  {
    role: 'system' as const,
    content: systemPrompt,
    providerOptions: { [cachePoint.key]: { [cachePoint.field]: cachePoint.value } },
  },
]

async function runTurn(history: ModelMessage[], userText: string) {
  const messages: ModelMessage[] = [
    ...systemMessages,
    ...history,
    { role: 'user', content: userText },
  ]
  const result = streamText({
    model: model(modelId!),
    messages,
    tools: { ping: pingTool },
    stopWhen: [stepCountIs(6)],
    maxOutputTokens: 1024,
    prepareStep: async ({ messages: stepMessages }) => {
      // Mirror routes/agent.ts: heal, then move the trailing checkpoint.
      healForBedrock(stepMessages)
      applyTrailingCachePoint(stepMessages, cachePoint)

      return {}
    },
  })

  await result.consumeStream()
  const steps = await result.steps

  return { steps, response: await result.response }
}

console.log(`provider: ${useVertex ? 'vertex' : 'bedrock'}  model: ${modelId}\n`)

// ── Phase 1: tool loop — the moved checkpoint must still hit ────────────────
console.log('phase 1: multi-step tool loop (3 sequential pings)')
const turn1 = await runTurn(
  [],
  'Call the ping tool exactly three times, one at a time (labels "a", then "b", then "c" — wait for each result before the next call). Then reply "done".',
)
const usages = turn1.steps.map((s) => s.usage)

usages.forEach((u, i) => console.log(`  step ${i}: ${fmt(u)}`))

if (turn1.steps.length < 3) fail(`expected >= 3 steps, got ${turn1.steps.length}`)
const first = usages[0]!

if ((first.inputTokenDetails.cacheWriteTokens ?? 0) === 0)
  fail('step 0 wrote nothing to cache — trailing checkpoint not applied?')
for (let i = 1; i < usages.length; i++) {
  const u = usages[i]!
  const prev = usages[i - 1]!
  const read = u.inputTokenDetails.cacheReadTokens ?? 0
  const prevCovered =
    (prev.inputTokenDetails.cacheReadTokens ?? 0) + (prev.inputTokenDetails.cacheWriteTokens ?? 0)

  if (read === 0) fail(`step ${i} read nothing from cache — moved checkpoint did not hit`)
  if (read < prevCovered)
    fail(
      `step ${i} cacheRead (${read}) < previous step's cached prefix (${prevCovered}) — history not fully re-read`,
    )
  if ((u.inputTokenDetails.noCacheTokens ?? 0) > 1000)
    fail(`step ${i} still re-billing ${u.inputTokenDetails.noCacheTokens} tokens uncached`)
}
console.log('  PASS: every step after the first re-read the full prior prefix from cache\n')

// ── Phase 2: follow-up request with route-style rebuilt history ─────────────
console.log('phase 2: follow-up request (history through stripReasoningParts + healForBedrock)')
const history = healForBedrock(
  stripReasoningParts([...turn1.response.messages] as Parameters<typeof stripReasoningParts>[0]),
) as ModelMessage[]
const turn2 = await runTurn(
  history,
  'How many times did you ping in total? Answer with just the number.',
)
const followUp = turn2.steps[0]!.usage

console.log(`  step 0: ${fmt(followUp)}`)
if ((followUp.inputTokenDetails.cacheReadTokens ?? 0) === 0)
  fail('follow-up request read nothing from cache — cross-request reuse broken')
console.log('  PASS: follow-up request re-read the prior conversation from cache\n')

console.log('cache smoke: ALL PASS')

// See thinking-smoke.ts: every real failure hard-exits 1 via fail(), so
// reaching this line means every assertion passed. Exit explicitly so a
// teardown-time rejection can't flip the verdict after the fact.
process.exit(0)
