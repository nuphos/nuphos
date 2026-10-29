import { optional } from './env'

/** Voice input: the deployment's OpenAI key transcribes for subscribed teams; unset turns it off. */
export type VoiceConfig = { openaiApiKey?: string }

export function voiceConfig(): VoiceConfig {
  const openaiApiKey = optional('OPENAI_API_KEY')?.trim()

  return openaiApiKey ? { openaiApiKey } : {}
}
