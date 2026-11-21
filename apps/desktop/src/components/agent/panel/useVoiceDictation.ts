import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { useTeamRole } from '../../../hooks/useTeamRole'
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
import {
  isSubscriptionRequired,
  markVoiceUnsubscribed,
  needsVoiceSubscription,
  planAllowsVoice,
  voiceSubscriptionToast,
} from './voiceSubscription'
import { createTakes } from './voiceTakes'

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

const noMeter = () => {
  // No meter to stop.
}

/**
 * Samples the stream's level every `METER_MS` into `onLevel`, through an
 * `AnalyserNode` on the same stream. Returns what stops it. A context that
 * starts suspended is resumed, or the waveform would stay flat.
 */
function meterStream(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext()

  if (context.state === 'suspended')
    context.resume().catch(() => {
      // The waveform stays flat; the recording itself is unaffected.
    })
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
  // Which take's transcript may still land, and whether ↑ asked to send it.
  // Created once, on the first render; it never changes, so it needs no ref.
  const [takes] = useState(createTakes)
  // Set by Discard and by unmounting: a take that was still asking for the microphone is
  // dropped when the stream arrives, and a finished one is not transcribed.
  const discard = useRef(false)
  const opening = useRef(false)
  const onTextRef = useRef(onText)
  // Only an administrator can subscribe; a role still loading gets Subscribe, as Billing explains.
  const role = useTeamRole(teamId)
  const canSubscribe = useRef(true)

  useEffect(() => {
    canSubscribe.current = role === undefined || role === 'ADMINISTRATOR'
  }, [role])

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const stop = useCallback(
    (options?: { send?: boolean }) => {
      if (recorder.current?.state !== 'recording') return
      takes.stop(options)
      recorder.current.stop()
    },
    [takes],
  )

  // While recording this discards the take; while transcribing, its transcript.
  const cancel = useCallback(() => {
    discard.current = true
    takes.discard()
    if (recorder.current?.state === 'recording') recorder.current.stop()
    else setPhase((current) => (current.kind === 'transcribing' ? { kind: 'idle' } : current))
  }, [takes])

  const start = useCallback(async () => {
    // One take at a time, including one still waiting on the permission prompt.
    if (!teamId || recorder.current || opening.current) return
    opening.current = true
    discard.current = false
    // Refused before: ask the plan again, since a teammate may have subscribed since.
    if (needsVoiceSubscription(teamId) && !(await planAllowsVoice(teamId))) {
      opening.current = false
      voiceSubscriptionToast(teamId, canSubscribe.current)

      return
    }
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
    let media: MediaRecorder

    try {
      media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (cause) {
      // Nothing records, so nothing would ever stop the microphone: stop it here.
      for (const track of stream.getTracks()) track.stop()
      toast.error(t('Voice input could not start'), microphoneHelp(cause))

      return
    }
    const chunks: Blob[] = []
    const id = takes.begin()
    let stopMeter = noMeter

    setLevels([])
    if (meter) {
      // A waveform that cannot start leaves the take recording, without one; the
      // tracks are stopped with the take as usual.
      try {
        stopMeter = meterStream(stream, (level) => setLevels((prev) => appendLevel(prev, level)))
      } catch {
        stopMeter = noMeter
      }
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
          const landing = takes.land(id, text)

          if (landing) onTextRef.current(text, landing)
          else if (takes.isCurrent(id) && !text.trim())
            toast.info(t('No speech was heard'), t('Try again closer to the microphone.'))
        })
        .catch((err: unknown) => {
          if (!isSubscriptionRequired(err)) {
            if (takes.isCurrent(id)) toast.apiError(t('Voice input failed'), err)

            return
          }
          markVoiceUnsubscribed(teamId)
          if (takes.isCurrent(id)) voiceSubscriptionToast(teamId, canSubscribe.current)
        })
        .finally(() => {
          if (takes.isCurrent(id)) setPhase({ kind: 'idle' })
        })
    }
    recorder.current = media
    media.start(1000)
    setNow(Date.now())
    setPhase({ kind: 'recording', startedAt: Date.now() })
  }, [teamId, meter, takes])

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
      takes.discard()
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [takes],
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
