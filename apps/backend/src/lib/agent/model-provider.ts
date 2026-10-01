// The one place that knows WHICH hosted-Claude backend serves a model call and
// what its wire options look like. Bedrock and Vertex reach the same Anthropic
// models, but three request-shaping details differ, and every one of them fails
// SILENTLY when sent to the wrong provider:
//
//   prompt caching  bedrock: providerOptions.bedrock.cachePoint = {type:'default'}
//                   vertex:  providerOptions.anthropic.cacheControl = {type:'ephemeral'}
//   thinking        bedrock: reasoningConfig{type,maxReasoningEffort,display}
//                   vertex:  thinking{type,display} + a sibling `effort`
//   usage label     'amazon-bedrock' vs 'vertex.anthropic' in the token rollup
//
// An unknown providerOptions key is dropped, not rejected: a Bedrock cachePoint
// sent to Vertex loses every cache breakpoint and re-bills the whole history at
// full input price (the exact regression #407/#408 fixed), and a Bedrock
// reasoningConfig sent to Vertex turns extended thinking off. Route through the
// helpers here instead of writing either literal at a call site.

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'

import { config } from '@/config'
import { BEDROCK_CACHE_POINT, VERTEX_CACHE_POINT } from '@/lib/agent/bedrock-heal'

import type { CachePointSpec } from '@/lib/agent/bedrock-heal'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { JSONValue } from 'ai'

/** A providerOptions bag, in the shape both `ai` and the providers accept. */
export type ProviderOptions = Record<string, Record<string, JSONValue>>

type ModelFactory = (modelId: string) => LanguageModelV3

// Memoized: config is frozen at boot, so one provider serves the process.
// Credentials stay undefined when unset so each cloud's default credential
// chain takes over (AWS: env vars / instance profile / IRSA; GCP: Application
// Default Credentials / workload identity).
let factory: ModelFactory | null = null

function createFactory(): ModelFactory {
  if (config.agent.modelProvider === 'vertex') {
    const vertex = createVertexAnthropic({
      project: config.agent.vertexProject,
      location: config.agent.vertexLocation,
    })

    return (modelId) => vertex(modelId)
  }
  const bedrock = createAmazonBedrock({
    region: config.agent.bedrockRegion,
    accessKeyId: config.agent.bedrockAccessKeyId,
    secretAccessKey: config.agent.bedrockSecretAccessKey,
  })

  return (modelId) => bedrock(modelId)
}

/** The model for every call site (turn loop, compaction, judges, rerank, ...). */
export function getModel(modelId: string): LanguageModelV3 {
  factory ??= createFactory()

  return factory(modelId)
}

/** Provider label recorded on token-usage rows, and what cost rollups group by. */
export function tokenUsageProvider(): string {
  return config.agent.modelProvider === 'vertex' ? 'vertex.anthropic' : 'amazon-bedrock'
}

/**
 * The GCP project a Vertex call is billed to, for per-row reconciliation
 * against the BigQuery billing export. undefined on Bedrock (and on Vertex
 * deployments that rely on the ADC project rather than setting one) — the
 * reconciliation script therefore takes its project from an explicit argument
 * and never guesses.
 */
export function vertexBillingProject(): string | undefined {
  return config.agent.modelProvider === 'vertex' ? config.agent.vertexProject : undefined
}

/**
 * Region label for telemetry, logs and usage rows — the place the request
 * actually went. `bedrockRegion` defaults to `us-east-1` whether or not Bedrock
 * is in use, so reading it directly attributes every Vertex call to an AWS
 * region that was never contacted.
 */
export function regionLabel(): string {
  return config.agent.modelProvider === 'vertex'
    ? config.agent.vertexLocation
    : config.agent.bedrockRegion
}

/**
 * Where and how this provider spells a cache breakpoint. Both providers cap a
 * request at 4 breakpoints. bedrock-heal takes this as an argument (it must
 * scan and strip breakpoints, and it stays config-free so the smoke scripts can
 * import it without the backend's full env).
 */
export function cachePointSpec(): CachePointSpec {
  return config.agent.modelProvider === 'vertex' ? VERTEX_CACHE_POINT : BEDROCK_CACHE_POINT
}

/**
 * Merge a cache breakpoint into an existing providerOptions bag, preserving
 * whatever else is already on it.
 */
export function withCachePoint(existing?: ProviderOptions): ProviderOptions {
  const { key, field, value } = cachePointSpec()

  return { ...existing, [key]: { ...existing?.[key], [field]: value } }
}

/**
 * Extended thinking wire options for the configured provider, or null when
 * AGENT_THINKING_MODE is unset. The MODE is declared by the operator and must
 * match the model's generation — 'adaptive' for Opus 4.8+, 'budget' for Haiku
 * 4.5 and earlier. Deliberately no model-name guessing: the outage came from
 * assuming the deployed model matched the default.
 */
export function thinkingProviderOptions(): ProviderOptions | null {
  const { thinkingMode, thinkingEffort, thinkingBudgetTokens, modelProvider } = config.agent

  if (thinkingMode === '') return null
  // display:'summarized' on both — without it Opus 4.8 streams no reasoning
  // content at all (verified against the live model): the thinking happens but
  // never reaches the transcript/journal, which is the whole point.
  if (modelProvider === 'vertex') {
    return thinkingMode === 'adaptive'
      ? {
          anthropic: {
            thinking: { type: 'adaptive', display: 'summarized' },
            effort: thinkingEffort,
          },
        }
      : { anthropic: { thinking: { type: 'enabled', budgetTokens: thinkingBudgetTokens } } }
  }

  return thinkingMode === 'adaptive'
    ? {
        bedrock: {
          reasoningConfig: {
            type: 'adaptive',
            maxReasoningEffort: thinkingEffort,
            display: 'summarized',
          },
        },
      }
    : {
        // No budget-vs-maxTokens cross-check needed: the provider adds the
        // budget ON TOP of maxOutputTokens on the wire
        // (inferenceConfig.maxTokens += thinkingBudget), so
        // budget_tokens < max_tokens holds structurally.
        bedrock: { reasoningConfig: { type: 'enabled', budgetTokens: thinkingBudgetTokens } },
      }
}
