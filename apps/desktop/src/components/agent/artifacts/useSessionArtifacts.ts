import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  artifactPagePath,
  pickArtifactVersion,
  publishSessionArtifacts,
  readArtifactCall,
  readArtifactLine,
  readPickedArtifactVersion,
  releaseSessionArtifacts,
  subscribeSessionArtifacts,
  takeRequestedArtifact,
} from '../../../lib/sessionArtifacts'

import { collectArtifacts } from './artifactPayload'

import type { ArtifactVersion } from './artifactPayload'
import type { Message } from '../panel/model'

const NONE: readonly ArtifactVersion[] = []

/** Keeps the store in step with the chat's messages while the chat is on screen. */
export function usePublishSessionArtifacts(sessionId: string, messages: readonly Message[]) {
  const [owner] = useState(() => Symbol('session artifacts'))
  const lines = useMemo(() => collectArtifacts(messages), [messages])

  useEffect(() => {
    publishSessionArtifacts(owner, sessionId, lines)
  }, [owner, sessionId, lines])
  useEffect(() => () => releaseSessionArtifacts(owner, sessionId), [owner, sessionId])
}

export function useArtifactLine(
  sessionId: string | null | undefined,
  artifactId: string,
): readonly ArtifactVersion[] {
  return useSyncExternalStore(
    subscribeSessionArtifacts,
    () => readArtifactLine(sessionId, artifactId) ?? NONE,
  )
}

export function usePickedArtifactVersion(
  sessionId: string | null | undefined,
  artifactId: string,
): number | undefined {
  return useSyncExternalStore(subscribeSessionArtifacts, () =>
    readPickedArtifactVersion(sessionId, artifactId),
  )
}

/** The version line a call belongs to, and its session; null until its chat publishes. */
export function useArtifactCall(toolCallId: string) {
  const sessionId = useSyncExternalStore(
    subscribeSessionArtifacts,
    () => readArtifactCall(toolCallId)?.sessionId,
  )
  const artifactId = useSyncExternalStore(
    subscribeSessionArtifacts,
    () => readArtifactCall(toolCallId)?.artifactId,
  )
  const line = useArtifactLine(sessionId, artifactId ?? '')

  return sessionId && artifactId && line.length > 0 ? { sessionId, artifactId, line } : null
}

/**
 * Opens an artifact a link asked for once this chat holds it, the way clicking
 * its card would: the pinned version beside the conversation.
 */
export function useOpenRequestedArtifact(
  sessionId: string,
  teamId: string | undefined,
  open: ((href: string, beside: boolean) => boolean) | undefined,
) {
  useEffect(() => {
    if (!teamId || !open) return
    const check = () => {
      const request = takeRequestedArtifact(sessionId)

      if (!request) return
      pickArtifactVersion(sessionId, request.artifactId, request.version)
      open(artifactPagePath(teamId, request.artifactId), false)
    }

    check()

    return subscribeSessionArtifacts(check)
  }, [sessionId, teamId, open])
}
