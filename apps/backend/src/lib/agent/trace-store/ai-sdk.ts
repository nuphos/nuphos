import { MongoTraceSpan } from './span'

import type { generateText, LanguageModel } from 'ai'

// SDK results expose important fields through getters, not own properties.
const RESULT_FIELDS = [
  'text',
  'reasoning',
  'reasoningText',
  'content',
  'files',
  'sources',
  'toolCalls',
  'toolResults',
  'finishReason',
  'rawFinishReason',
  'usage',
  'totalUsage',
  'steps',
  'request',
  'response',
  'warnings',
  'providerMetadata',
  'experimental_providerMetadata',
  'output',
  'object',
  'value',
  'values',
  'responses',
  'rawResponse',
] as const

function responseSnapshot(result: unknown): Record<string, unknown> {
  const source = result as Record<string, unknown>
  const snapshot: Record<string, unknown> = {}

  for (const key of RESULT_FIELDS) {
    try {
      if (source[key] !== undefined) snapshot[key] = source[key]
    } catch {
      // Structured output can throw on invalid JSON; text/steps survive.
    }
  }

  return snapshot
}

// Match Braintrust's transport exclusions; structured prompts/results remain.
export function withoutTransport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTransport)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = { ...value }

  for (const field of ['request', 'response', 'rawResponse']) {
    const transport = out[field]

    if (transport && typeof transport === 'object') {
      const { body: _body, headers: _headers, ...rest } = transport as Record<string, unknown>

      out[field] = rest
    }
  }
  if (out.steps) out.steps = withoutTransport(out.steps)

  return out
}

function traceModel<T extends Exclude<LanguageModel, string>>(model: T): T {
  return new Proxy(model, {
    get(target, property) {
      const original = Reflect.get(target, property, target)

      if (property !== 'doGenerate' || typeof original !== 'function')
        return typeof original === 'function' ? original.bind(target) : original

      return async (...args: unknown[]) => {
        const span = new MongoTraceSpan({
          name: 'ai.doGenerate',
          type: 'llm',
          input: args[0],
          metadata: { modelId: model.modelId, provider: model.provider },
        })

        return span.withActive(async () => {
          try {
            const result: unknown = await Reflect.apply(original, target, args)

            span.record('log', { output: withoutTransport(result) })

            return result
          } catch (error) {
            span.record('log', { error })
            throw error
          } finally {
            span.end()
          }
        })
      }
    },
  })
}

// Current wrapAI call sites all use generateText. Provider attempts preserve
// retries/steps even when the outer call fails.
export function wrapMongoGenerateText(generate: typeof generateText): typeof generateText {
  return (async (options: Parameters<typeof generateText>[0]) => {
    const { model, output, ...input } = options
    const modelInfo =
      typeof model === 'string'
        ? { modelId: model }
        : { modelId: model.modelId, provider: model.provider }
    const span = new MongoTraceSpan({
      name: 'generateText',
      type: 'function',
      input: { ...input, model: modelInfo },
      metadata: { ...options.experimental_telemetry?.metadata, ...modelInfo },
    })

    return span.withActive(async () => {
      try {
        if (output) span.record('log', { outputFormat: await output.responseFormat })
        const tracedModel = typeof model === 'string' ? model : traceModel(model)
        const result = await generate({ ...options, model: tracedModel })

        span.record('log', { output: withoutTransport(responseSnapshot(result)) })

        return result
      } catch (error) {
        span.record('log', { error })
        throw error
      } finally {
        span.end()
      }
    })
  }) as typeof generateText
}
