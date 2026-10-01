import { generateText as rawGenerateText } from 'ai'

import { config } from '@/config'
import { aiTelemetry, wrapAI } from '@/lib/agent/braintrust'
import { extractFencedBlock } from '@/lib/agent/text-scan'
import { newModelCallId, recordSideCallTokenUsage } from '@/lib/agent/token-usage-side-call'
import { logError } from '@/lib/observability'

import { getModel, regionLabel } from './model-provider'

const { generateText } = wrapAI({ generateText: rawGenerateText })

export type StarterSuggestion = {
  /** Short imperative label shown on the card (<= ~40 chars). */
  title: string
  /** Concrete first message seeded into the composer when the card is picked. */
  prompt: string
}

const MAX_SUGGESTIONS = 4
// Cap the resource list we feed the model — a team can bind dozens of accounts,
// but the kinds that matter for framing a suggestion are few.
const MAX_RESOURCES = 24

function languageHint(locale: string): string {
  if (locale.startsWith('zh')) return '使用繁體中文'
  if (locale.startsWith('ja')) return '日本語で'
  if (locale.startsWith('ko')) return '한국어로'

  return 'in English'
}

// The model occasionally wraps JSON in a ```json fence or adds a stray sentence.
// Pull the first well-formed array out rather than trusting the whole string.
function extractJsonArray(text: string): unknown {
  const candidate = extractFencedBlock(text) ?? text
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')

  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function coerceSuggestions(parsed: unknown): StarterSuggestion[] {
  if (!Array.isArray(parsed)) return []
  const out: StarterSuggestion[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const title = (item as { title?: unknown }).title
    const prompt = (item as { prompt?: unknown }).prompt

    if (typeof title !== 'string' || typeof prompt !== 'string') continue
    const t = title.trim()
    const p = prompt.trim()

    if (!t || !p) continue
    out.push({ title: t.slice(0, 60), prompt: p.slice(0, 400) })
    if (out.length >= MAX_SUGGESTIONS) break
  }

  return out
}

/**
 * Generate a handful of starter questions tailored to the resources a team has
 * just connected — e.g. with Slack bound, suggest wiring up a trigger that
 * posts to Slack when an anomaly is detected. Best-effort: returns [] on any
 * failure so the caller can fall back to static presets without surfacing an
 * error to the user.
 */
export async function generateStarterSuggestions(
  resources: string[],
  locale = 'en-US',
  context?: { userId?: string; teamId?: string },
): Promise<StarterSuggestion[]> {
  const cleaned = Array.from(new Set(resources.map((r) => r.trim()).filter(Boolean))).slice(
    0,
    MAX_RESOURCES,
  )

  if (cleaned.length === 0) return []

  const model = getModel(config.agent.agentModelId)

  const prompt = [
    'You are onboarding a user of Nuphos, an AI agent that operates on their real',
    'cloud infrastructure and connected tools. The user has just connected these',
    `resources: ${cleaned.join(', ')}.`,
    '',
    `Suggest exactly ${String(MAX_SUGGESTIONS)} starter tasks that get them value fast and`,
    'that specifically exercise the resources they connected. Prefer concrete,',
    'high-signal actions over generic advice. When a monitoring/alerting or',
    'messaging tool is connected (e.g. Slack, Grafana, BetterStack), include at',
    'least one that sets up a trigger/automation (for example: "when an anomaly',
    'is detected, send a message to Slack"). Combine resources when it makes',
    'sense (e.g. GitHub deploy + notify Slack).',
    '',
    'Return ONLY a JSON array of objects, no prose, no markdown fence. Each object:',
    '  - "title": a short imperative label, at most 40 characters',
    '  - "prompt": the exact first message the user would send to the agent,',
    '    phrased in first person, concrete, mentioning the relevant connected',
    '    resource by name.',
    `Write both fields ${languageHint(locale)}.`,
  ].join('\n')

  const callId = newModelCallId()

  try {
    const result = await generateText({
      model,
      maxOutputTokens: 700,
      experimental_telemetry: aiTelemetry({
        userId: context?.userId,
        locale,
        phase: 'starter-suggestions',
        provider: config.agent.modelProvider,
        modelId: config.agent.agentModelId,
        region: regionLabel(),
      }),
      messages: [{ role: 'user', content: prompt }],
    })

    await recordSideCallTokenUsage({
      operation: 'starter_suggestions',
      callId,
      modelId: config.agent.agentModelId,
      context: context ?? {},
      usage: (result as { usage?: unknown }).usage,
    })

    return coerceSuggestions(extractJsonArray(result.text))
  } catch (error) {
    logError('agent.starter_suggestions.error', error, {
      user_id: context?.userId,
      team_id: context?.teamId,
      provider: config.agent.modelProvider,
      model_id: config.agent.agentModelId,
      region: regionLabel(),
    })

    return []
  }
}
