import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db/shared'
import { logError } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { developmentRuntimeEndpoint } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

// Removes the conversation's CLI home that apps/runtime/image/session-home.mjs
// creates: <runtime HOME>/.nuphos/session-homes/<sha256(sessionId)>.
// Request data is JSON, never interpolated into executable code or a shell.
export const FORGET_SESSION_HOME_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { createHash } = await import('node:crypto');
const { sessionId } = JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'));
if (typeof sessionId !== 'string' || !sessionId.trim()) process.exit(2);
const id = createHash('sha256').update(sessionId).digest('hex');
await fs.rm(path.join(os.homedir(), '.nuphos', 'session-homes', id), { recursive: true, force: true });
`

/**
 * A conversation that has ended (archived, or a finished one-shot trigger run) no
 * longer needs its CLI home on the agent that ran it, and every home holds its own
 * installs and logins. A later turn starts from an empty home, as a new conversation
 * does. Agents on someone's own computer are not reached; their disk is theirs.
 */
export async function forgetRuntimeSessionHome(sessionId: string): Promise<void> {
  const conversation = await agentConversations().findOne(
    { sessionId },
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
    throw new Error(`Removing the session home failed: ${JSON.stringify(result)}`)
}

/** In the background, one at a time; an unreachable agent keeps the home until a later archive. */
export function forgetSessionHomes(sessionIds: string[]): void {
  void (async () => {
    for (const sessionId of sessionIds)
      await forgetRuntimeSessionHome(sessionId).catch((err: unknown) => {
        logError('agent.session_home_forget.failed', err, { session_id: sessionId })
      })
  })()
}
