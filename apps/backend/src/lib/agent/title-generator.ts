import { createHash } from 'node:crypto'

import { generateText as rawGenerateText } from 'ai'

import { config } from '@/config'
import { aiTelemetry, wrapAI } from '@/lib/agent/braintrust'
import {
  makeTokenUsageRecordsForModelCall,
  recordAgentTokenUsageRecords,
} from '@/lib/agent/token-usage'
import { logError } from '@/lib/observability'

import { getModel, regionLabel, tokenUsageProvider, vertexBillingProject } from './model-provider'
import { fallbackTitle } from './title-fallback'

const { generateText } = wrapAI({ generateText: rawGenerateText })
const TOKEN_USAGE_PROVIDER = tokenUsageProvider()

/**
 * Generate a conversation title using AI based on the first exchange.
 */
export async function generateConversationTitle(
  userMessage: string,
  assistantResponse: string,
  locale = 'en-US',
  context?: { userId?: string; sessionId?: string; teamId?: string },
): Promise<string> {
  // Use the main agent model — Bedrock has marked claude-3-5-haiku-20241022 as
  // Legacy and revokes access after 30 days of inactivity, breaking title gen.
  const model = getModel(config.agent.agentModelId)

  const languageHint = locale.startsWith('zh')
    ? '使用繁體中文'
    : locale.startsWith('ja')
      ? '日本語で'
      : locale.startsWith('ko')
        ? '한국어로'
        : 'in English'

  try {
    const result = await generateText({
      model,
      // Generous next to a 50-character title: the model may spend output
      // tokens on a preamble before the title. At 50 it regularly hit the cap
      // with nothing usable emitted, and the caller then stored an empty title.
      maxOutputTokens: 200,
      experimental_telemetry: aiTelemetry({
        userId: context?.userId,
        sessionId: context?.sessionId,
        teamId: context?.teamId,
        locale,
        phase: 'title-gen',
        provider: config.agent.modelProvider,
        modelId: config.agent.agentModelId,
        region: regionLabel(),
      }),
      messages: [
        {
          role: 'user',
          content: [
            'Generate a short, concise title (max 50 characters) for this conversation ',
            languageHint,
            '. Only output the title, nothing else.\n\n',
            'User: ',
            userMessage.slice(0, 500),
            '\n\nAssistant: ',
            assistantResponse.slice(0, 500),
          ].join(''),
        },
      ],
    })

    await recordTitleTokenUsage({
      context,
      usage: (result as { usage?: unknown }).usage,
      userMessage,
      assistantResponse,
    })

    const title = result.text.trim()

    // A call can succeed and still yield nothing usable — e.g. the whole output
    // budget went to a preamble and the response got cut at the cap. Falling
    // back here matters: an empty title reaches the sidebar as the raw first
    // message.
    if (!title) {
      logError(
        'agent.title_generation.empty_result',
        new Error('title generation returned no text'),
        {
          user_id: context?.userId,
          session_id: context?.sessionId,
          finish_reason: result.finishReason,
          output_tokens: result.usage?.outputTokens,
        },
      )

      return fallbackTitle(userMessage)
    }
    if (title.length > 60) return `${title.slice(0, 57)}...`

    return title
  } catch (error) {
    logError('agent.title_generation.error', error, {
      user_id: context?.userId,
      session_id: context?.sessionId,
      provider: config.agent.modelProvider,
      model_id: config.agent.agentModelId,
      region: regionLabel(),
    })

    return fallbackTitle(userMessage)
  }
}

async function recordTitleTokenUsage(args: {
  context: { userId?: string; sessionId?: string; teamId?: string } | undefined
  usage: unknown
  userMessage: string
  assistantResponse: string
}): Promise<void> {
  if (!args.context?.sessionId || !args.context.userId) return
  const recordHash = createHash('sha256')
    .update(args.userMessage.slice(0, 500))
    .update('\0')
    .update(args.assistantResponse.slice(0, 500))
    .digest('hex')
    .slice(0, 16)

  try {
    await recordAgentTokenUsageRecords(
      makeTokenUsageRecordsForModelCall({
        recordPrefix: `${args.context.sessionId}:title_generation:${recordHash}`,
        sessionId: args.context.sessionId,
        userId: args.context.userId,
        teamId: args.context.teamId,
        operation: 'title_generation',
        source: 'ai-sdk',
        provider: TOKEN_USAGE_PROVIDER,
        modelId: config.agent.agentModelId,
        region: regionLabel(),
        gcpProject: vertexBillingProject(),
        stepIndex: 0,
        stepNumber: 1,
        usage: args.usage,
      }),
    )
  } catch (err) {
    logError('agent.title_generation.token_usage_persist.error', err, {
      user_id: args.context.userId,
      session_id: args.context.sessionId,
      team_id: args.context.teamId,
      provider: config.agent.modelProvider,
      model_id: config.agent.agentModelId,
    })
  }
}
