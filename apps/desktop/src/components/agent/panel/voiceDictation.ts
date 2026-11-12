/**
 * Voice input in the composer: what is recorded, how long, and how the
 * transcript lands. The recording goes to the same Whisper route the iOS and
 * Android apps use (`POST /teams/:teamId/voice-transcriptions`).
 */

/** Spelling hints for Whisper, the same list the iOS and Android apps send by default. */
export const VOICE_PROMPT = 'Nuphos, Claude Code, Codex, GitHub, Linear, Slack, Discord.'

/** Longest take: far below the route's 25 MB limit at the recorder's Opus bitrate. */
export const MAX_RECORDING_MS = 10 * 60 * 1000

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

/** The first container the recorder supports; Whisper accepts WebM and Ogg as recorded. */
export function recordingMimeType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDING_TYPES.find(isSupported)
}

/** Whisper reads the format from the file name. */
export function recordingFilename(mimeType: string): string {
  return mimeType.startsWith('audio/ogg') ? 'dictation.ogg' : 'dictation.webm'
}

/** `m:ss` for the recording timer. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

/** The transcript as inserted after `before`: a space keeps it off a preceding word. */
export function dictationInsert(text: string, before: string): string {
  const words = text.trim()

  if (!words) return ''

  return before &&
    !/\s$/.test(before) &&
    /^[\p{L}\p{N}]/u.test(words) &&
    /[\p{L}\p{N}.,!?;:)]$/u.test(before)
    ? ` ${words}`
    : words
}

/** ⌘⇧U on macOS, Ctrl+Shift+U elsewhere: start or stop voice input. */
export function isVoiceShortcut(
  event: Pick<
    KeyboardEvent,
    'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'
  >,
  mac: boolean,
): boolean {
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.code === 'KeyU' &&
    !event.isComposing
  )
}
