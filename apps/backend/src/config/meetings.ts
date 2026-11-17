import { boundedInt, optional } from './env'

/** Bots joining meetings through Recall.ai; unset turns meeting_join off. */
export type MeetingsConfig = {
  recall?: {
    apiKey: string
    /** Recall region host prefix, e.g. us-west-2. */
    region: string
    /** Workspace verification secret (whsec_…) that signs Recall's webhooks. */
    webhookSecret: string
    /** Recall's `transcript.provider` as given, e.g. Soniox for Chinese; unset is English only. */
    transcriptProvider?: object
    /** Bots one team may send into calls in any 24 hours. */
    botsPerTeamPerDay: number
  }
}

export function meetingsConfig(): MeetingsConfig {
  const apiKey = optional('RECALL_API_KEY')?.trim()
  const webhookSecret = optional('RECALL_WEBHOOK_SECRET')?.trim()

  if (!apiKey || !webhookSecret) return {}

  return {
    recall: {
      apiKey,
      region: optional('RECALL_REGION')?.trim() || 'us-west-2',
      webhookSecret,
      transcriptProvider: providerJson(optional('RECALL_TRANSCRIPT_PROVIDER')?.trim()),
      botsPerTeamPerDay: boundedInt('RECALL_MAX_BOTS_PER_TEAM_PER_DAY', 20, {
        min: 1,
        max: 10_000,
      }),
    },
  }
}

function providerJson(raw: string | undefined): object | undefined {
  if (!raw) return undefined
  const value: unknown = JSON.parse(raw)

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('RECALL_TRANSCRIPT_PROVIDER must be a JSON object')

  return value
}
