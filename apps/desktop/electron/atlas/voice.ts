import { callMultipart } from './client'

/**
 * A composer recording, transcribed by the backend's Whisper route — the same
 * one the iOS and Android apps use. Its errors keep their codes
 * (`subscription_required`, `voice_unavailable`, `recording_too_large`,
 * `transcription_failed`) for the renderer's toast.
 */
export async function voiceTranscribe(
  teamId: string,
  file: { filename: string; bytes: Uint8Array; contentType?: string },
  prompt?: string,
): Promise<{ text: string; language: string | null }> {
  return callMultipart(
    `/teams/${encodeURIComponent(teamId)}/voice-transcriptions`,
    prompt ? { prompt } : {},
    file,
    { timeoutMs: 90_000 },
  )
}
