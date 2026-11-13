import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { locale, t } from '../../../i18n'
import { toast } from '../../ui/toast'

import {
  MAX_RECORDING_MS,
  VOICE_PROMPT,
  dictationText,
  openMicrophone,
  recordingFilename,
  recordingMimeType,
} from './voiceDictation'

export type VoicePhase =
  { kind: 'idle' } | { kind: 'recording'; startedAt: number } | { kind: 'transcribing' }

/** Why the microphone would not start, in words the person can act on. */
function microphoneHelp(cause: unknown): string {
  const name = (cause as { name?: unknown } | null)?.name

  if (name === 'NotAllowedError' || name === 'SecurityError')
    return t('Allow Nuphos to use the microphone in System Settings, then try again.')
  if (name === 'NotFoundError') return t('No microphone was found.')

  return t('The microphone could not be started.')
}

/**
 * One voice-input take: record, then transcribe and hand the text over.
 * Cancelling, or the composer going away, discards the recording.
 */
export function useVoiceDictation({
  teamId,
  onText,
}: {
  teamId?: string
  onText: (text: string) => void
}) {
  const [phase, setPhase] = useState<VoicePhase>({ kind: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  const recorder = useRef<MediaRecorder | null>(null)
  // Set by Discard and by unmounting: a take that was still asking for the microphone is
  // dropped when the stream arrives, and a finished one is not transcribed.
  const discard = useRef(false)
  const opening = useRef(false)
  const onTextRef = useRef(onText)

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const cancel = useCallback(() => {
    discard.current = true
    stop()
  }, [stop])

  const start = useCallback(async () => {
    // One take at a time, including one still waiting on the permission prompt.
    if (!teamId || recorder.current || opening.current) return
    opening.current = true
    discard.current = false
    let stream: MediaStream | null

    try {
      stream = await openMicrophone(
        () => navigator.mediaDevices.getUserMedia({ audio: true }),
        () => discard.current,
      )
    } catch (cause) {
      if (!discard.current) toast.error(t('Voice input could not start'), microphoneHelp(cause))

      return
    } finally {
      opening.current = false
    }
    if (!stream) return
    const mimeType = recordingMimeType((type) => MediaRecorder.isTypeSupported(type))
    const take = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []

    take.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    take.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      if (discard.current || chunks.length === 0) {
        setPhase({ kind: 'idle' })

        return
      }
      const type = take.mimeType !== '' ? take.mimeType : (mimeType ?? 'audio/webm')

      setPhase({ kind: 'transcribing' })
      void new Blob(chunks, { type })
        .arrayBuffer()
        .then((buffer) =>
          api.voiceTranscribe(
            teamId,
            { filename: recordingFilename(type), bytes: new Uint8Array(buffer), contentType: type },
            VOICE_PROMPT,
          ),
        )
        .then((reply) => dictationText(reply, locale))
        .then((text) => {
          if (!discard.current && text.trim()) onTextRef.current(text)
        })
        .catch((err: unknown) => {
          toast.apiError(t('Voice input failed'), err)
        })
        .finally(() => {
          setPhase({ kind: 'idle' })
        })
    }
    recorder.current = take
    take.start(1000)
    setNow(Date.now())
    setPhase({ kind: 'recording', startedAt: Date.now() })
  }, [teamId])

  const toggle = useCallback(() => {
    if (phase.kind === 'recording') stop()
    else if (phase.kind === 'idle') void start()
  }, [phase.kind, start, stop])

  // The timer, and the cap that ends a take left running.
  useEffect(() => {
    if (phase.kind !== 'recording') return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() - phase.startedAt >= MAX_RECORDING_MS) stop()
    }, 500)

    return () => clearInterval(id)
  }, [phase, stop])

  useEffect(
    () => () => {
      discard.current = true
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )

  return {
    phase,
    elapsedMs: phase.kind === 'recording' ? now - phase.startedAt : 0,
    available: Boolean(teamId),
    start,
    stop,
    cancel,
    toggle,
  }
}
