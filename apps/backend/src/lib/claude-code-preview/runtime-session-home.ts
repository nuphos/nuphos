import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db/shared'
import { claimAgentRunForSession } from '@/lib/agent/run-admission'
import { logError, logEvent } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { developmentRuntimeEndpoint } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

// Empties the conversation's CLI home that apps/runtime/image/session-home.mjs
// creates: <runtime HOME>/.nuphos/session-homes/<sha256(sessionId)>. The empty
// directory stays, because the agent's inner session may still be alive in the
// runtime pool and keeps that HOME until it is reaped.
// Request data is JSON, never interpolated into executable code or a shell.
export const FORGET_SESSION_HOME_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { createHash } = await import('node:crypto');
const { sessionId } = JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'));
if (typeof sessionId !== 'string' || !sessionId.trim()) process.exit(2);
const id = createHash('sha256').update(sessionId).digest('hex');
const home = path.join(os.homedir(), '.nuphos', 'session-homes', id);
await fs.rm(home, { recursive: true, force: true });
await fs.mkdir(home, { recursive: true, mode: 0o700 });
`

/**
 * An archived conversation no longer needs the installs and logins in its CLI
 * home. A turn after unarchiving starts from an empty home, as a new
 * conversation does. Holding the run claim keeps a turn from starting while the
 * home is emptied; a conversation that is running or was restored keeps its home.
 * Agents on someone's own computer are not reached; their disk is theirs.
 */
export async function forgetRuntimeSessionHome(sessionId: string): Promise<void> {
  const owner = await agentConversations().findOne({ sessionId }, { projection: { userId: 1 } })

  if (!owner) return
  const release = await claimAgentRunForSession(owner.userId, sessionId, true)

  if (!release) {
    logEvent('info', 'agent.session_home_forget.skipped_busy', { session_id: sessionId })

    return
  }
  try {
    const conversation = await agentConversations().findOne(
      { sessionId, archivedAt: { $exists: true } },
      { projection: { teamId: 1, runtimeId: 1, agentRuntime: 1 } },
    )
    const { teamId, runtimeId, agentRuntime: provider = 'claude-code' } = conversation ?? {}

    if (!teamId || !runtimeId) return
    const endpoint =
      runtimeId === `development-${provider}`
        ? developmentRuntimeEndpoint(provider, 'control')
        : (await resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control')).find(
            (item) => item.runtimeId === runtimeId,
          )

    if (!endpoint) return
    const client = await controlRegistry.acquire(teamId, endpoint)

    if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel')) return
    const result = await client.runJob(
      {
        jobId: randomUUID(),
        job: 'panel',
        env: {},
        stdin: JSON.stringify({
          runner: FORGET_SESSION_HOME_PROGRAM,
          script: '',
          params: { sessionId },
        }),
        timeoutMs: 60_000,
        maxStdoutBytes: 1024,
      },
      65_000,
    )

    if (result.timedOut || result.exitCode !== 0)
      throw new Error(`Emptying the session home failed: ${JSON.stringify(result)}`)
  } finally {
    release()
  }
}

/** In the background, one at a time; an unreachable agent keeps the home until a later archive. */
export function forgetArchivedSessionHomes(sessionIds: string[]): void {
  void (async () => {
    for (const sessionId of sessionIds)
      await forgetRuntimeSessionHome(sessionId).catch((err: unknown) => {
        logError('agent.session_home_forget.failed', err, { session_id: sessionId })
      })
  })()
}
