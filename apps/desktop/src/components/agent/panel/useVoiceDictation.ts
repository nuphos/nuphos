import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { locale, t } from '../../../i18n'
import { toast } from '../../ui/toast'

import {
  MAX_RECORDING_MS,
  VOICE_PROMPT,
  appendLevel,
  dictationText,
  levelFromSamples,
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

/** How often the waveform takes a level, as on iOS. */
const METER_MS = 60

/**
 * Samples the stream's level every `METER_MS` into `onLevel`, through an
 * `AnalyserNode` on the same stream. Returns what stops it.
 */
function meterStream(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext()
  const analyser = context.createAnalyser()

  analyser.fftSize = 1024
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Uint8Array(analyser.fftSize)
  const id = setInterval(() => {
    analyser.getByteTimeDomainData(samples)
    onLevel(levelFromSamples(samples))
  }, METER_MS)

  return () => {
    clearInterval(id)
    context.close().catch(() => {
      // Already closed: nothing left to release.
    })
  }
}

/**
 * One voice-input take: record, then transcribe and hand the text over.
 * Cancelling, or the composer going away, discards the recording. With
 * `meter`, `levels` holds the take's recent microphone levels for a waveform.
 * `stop({ send: true })` asks the caller to send the text once it is in.
 */
export function useVoiceDictation({
  teamId,
  onText,
  meter = false,
}: {
  teamId?: string
  onText: (text: string, options: { send: boolean }) => void
  meter?: boolean
}) {
  const [phase, setPhase] = useState<VoicePhase>({ kind: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  const [levels, setLevels] = useState<number[]>([])
  const recorder = useRef<MediaRecorder | null>(null)
  // Each take, and each cancel, gets a new number: a transcript that arrives for an
  // older one is dropped, so a cancelled take never lands after a new one starts.
  const take = useRef(0)
  const sendAfter = useRef(false)
  // Set by Discard and by unmounting: a take that was still asking for the microphone is
  // dropped when the stream arrives, and a finished one is not transcribed.
  const discard = useRef(false)
  const opening = useRef(false)
  const onTextRef = useRef(onText)

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const stop = useCallback((options?: { send?: boolean }) => {
    if (recorder.current?.state !== 'recording') return
    sendAfter.current = options?.send === true
    recorder.current.stop()
  }, [])

  // While recording this discards the take; while transcribing, its transcript.
  const cancel = useCallback(() => {
    discard.current = true
    take.current += 1
    if (recorder.current?.state === 'recording') recorder.current.stop()
    else setPhase((current) => (current.kind === 'transcribing' ? { kind: 'idle' } : current))
  }, [])

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
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const id = ++take.current

    sendAfter.current = false
    setLevels([])
    const stopMeter = meter
      ? meterStream(stream, (level) => setLevels((prev) => appendLevel(prev, level)))
      : () => {
          // No meter to stop.
        }

    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    media.onstop = () => {
      stopMeter()
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      if (discard.current || chunks.length === 0) {
        setPhase({ kind: 'idle' })

        return
      }
      const send = sendAfter.current
      const type = media.mimeType !== '' ? media.mimeType : (mimeType ?? 'audio/webm')

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
          if (take.current === id && text.trim()) onTextRef.current(text, { send })
        })
        .catch((err: unknown) => {
          if (take.current === id) toast.apiError(t('Voice input failed'), err)
        })
        .finally(() => {
          if (take.current === id) setPhase({ kind: 'idle' })
        })
    }
    recorder.current = media
    media.start(1000)
    setNow(Date.now())
    setPhase({ kind: 'recording', startedAt: Date.now() })
  }, [teamId, meter])

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
      take.current += 1
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )

  return {
    phase,
    elapsedMs: phase.kind === 'recording' ? now - phase.startedAt : 0,
    levels,
    available: Boolean(teamId),
    start,
    stop,
    cancel,
    toggle,
  }
}
