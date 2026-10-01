// "Continue this local session on a team agent": one PUT that creates the
// conversation with the local log's turns already in it. The transcript endpoint
// only accepts a client-authored body while no conversation exists yet, so this
// is a one-shot import — every later turn belongs to the runtime.
import { randomUUID } from 'node:crypto'

import { readLocalSessionTranscript } from '../main/local-session-transcript.ts'
import { listLocalAgentSessions, validateLocalSessionSource } from '../main/local-sessions.ts'

import { callJson, teamQuery } from './http.ts'

import type { ImportedTranscript } from '../main/local-session-transcript.ts'

export type LocalSessionImportResult = {
  sessionId: string
  title: string
  messageCount: number
  /** Turns the import caps left out of the front of the transcript. */
  dropped: number
}

export async function importLocalSession(args: {
  source: string
  /** The `id` of a session `listLocalAgentSessions` returned. */
  id: string
  teamId: string
  runtimeId: string
  agentRuntime: 'claude-code' | 'codex'
}): Promise<LocalSessionImportResult> {
  const source = validateLocalSessionSource(args.source)
  // Never open a path the renderer names: re-list the sessions and import one of
  // those. The set main itself just enumerated is the whole allow-list, so there
  // is no path to canonicalize or contain.
  const session = (await listLocalAgentSessions(source)).find((entry) => entry.id === args.id)

  if (!session) {
    throw new Error('That session is no longer one of this computer’s recent sessions.')
  }
  const transcript: ImportedTranscript = await readLocalSessionTranscript(source, session.path)

  if (transcript.messages.length === 0) {
    throw new Error('This session has no messages to import.')
  }
  const sessionId = randomUUID()

  await callJson<{ ok: boolean }>(
    'PUT',
    `/agent/conversations/${encodeURIComponent(sessionId)}/transcript${teamQuery(args.teamId)}`,
    {
      title: transcript.title,
      agentRuntime: args.agentRuntime,
      runtimeId: args.runtimeId,
      messages: transcript.messages,
    },
  )

  return {
    sessionId,
    title: transcript.title,
    messageCount: transcript.messages.length,
    dropped: transcript.dropped,
  }
}
