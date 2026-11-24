import { optional } from './env'

/** Voice input: the deployment's OpenAI key transcribes for subscribed teams; unset turns it off. */
export type VoiceConfig = { openaiApiKey?: string; openaiBaseUrl: string }

export function voiceConfig(): VoiceConfig {
  const openaiApiKey = optional('OPENAI_API_KEY')?.trim()
  // A stand-in Whisper for tests; OpenAI's own API otherwise.
  const openaiBaseUrl = optional('OPENAI_BASE_URL')?.trim() || 'https://api.openai.com/v1'

  return openaiApiKey ? { openaiApiKey, openaiBaseUrl } : { openaiBaseUrl }
}
