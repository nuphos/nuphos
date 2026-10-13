import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db/shared'
import { logError, logEvent } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { developmentRuntimeEndpoint } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { conversationExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db/shared'

// Removes the conversation's CLI home that apps/runtime/image/session-home.mjs
// creates: <runtime HOME>/.nuphos/session-homes/<sha256(sessionId)>, unless a
// process still runs with that HOME or inside it (a turn that just started, or
// a shell left running). The next session start recreates the home.
// Request data is JSON, never interpolated into executable code or a shell.
export const RECLAIM_SESSION_HOME_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { createHash } = await import('node:crypto');
const { sessionId } = JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'));
if (typeof sessionId !== 'string' || !sessionId.trim()) process.exit(2);
const id = createHash('sha256').update(sessionId).digest('hex');
const home = path.join(os.homedir(), '.nuphos', 'session-homes', id);
const done = (result) => { process.stdout.write(JSON.stringify({ result })); process.exit(0); };
if (!(await fs.lstat(home).catch(() => null))) done('absent');
for (const pid of await fs.readdir('/proc')) {
  if (!/^\d+$/.test(pid)) continue;
  const env = (await fs.readFile('/proc/' + pid + '/environ', 'utf8').catch(() => '')).split('\0');
  const cwd = await fs.readlink('/proc/' + pid + '/cwd').catch(() => '');
  if (env.includes('HOME=' + home) || cwd === home || cwd.startsWith(home + '/')) done('in_use');
}
await fs.rm(home, { recursive: true, force: true });
done('removed');
`

const RETRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

type ReclaimCandidate = Pick<
  AgentConversation,
  | 'teamId'
  | 'sessionId'
  | 'userId'
  | 'agentRuntime'
  | 'runtimeId'
  | 'claudeCodePreview'
  | 'runtimeMigration'
  | 'archivedAt'
> & { sessionHomeReclaimedAt?: Date } // Set once this archive's home is gone.

/**
 * Removes an archived conversation's CLI home once the runtime reports no live
 * session for it. Returns false when the home is still in use, so a later sweep
 * retries. Agents on someone's own computer are not reached; their disk is theirs.
 */
export async function reclaimSessionHome(conversation: ReclaimCandidate): Promise<boolean> {
  const { teamId, runtimeId, agentRuntime: provider = 'claude-code' } = conversation

  if (!teamId || !runtimeId) return true
  const endpoint =
    runtimeId === `development-${provider}`
      ? developmentRuntimeEndpoint(provider, 'control')
      : (await resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control')).find(
          (item) => item.runtimeId === runtimeId,
        )

  // The runtime is gone, or it is someone's own computer: nothing to reclaim.
  if (!endpoint) return true
  // Only the runtime knows whether its inner session (and any async task) is live.
  if ((await conversationExecutionState(conversation)).state !== 'dormant') return false
  const client = await controlRegistry.acquire(teamId, endpoint)

  if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel')) return true
  const result = await client.runJob(
    {
      jobId: randomUUID(),
      job: 'panel',
      env: {},
      stdin: JSON.stringify({
        runner: RECLAIM_SESSION_HOME_PROGRAM,
        script: '',
        params: { sessionId: conversation.sessionId },
      }),
      timeoutMs: 60_000,
      maxStdoutBytes: 1024,
    },
    65_000,
  )

  if (result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string')
    throw new Error(`Reclaiming the session home failed: ${JSON.stringify(result)}`)

  return (JSON.parse(result.stdout) as { result?: string }).result !== 'in_use'
}

/**
 * Hourly: archived conversations whose home is not reclaimed since they were
 * archived. One that is still running is retried on the next sweep.
 */
export async function reclaimArchivedSessionHomes(now = new Date()): Promise<number> {
  const candidates = await agentConversations()
    .find(
      { archivedAt: { $gt: new Date(now.getTime() - RETRY_WINDOW_MS) } },
      {
        projection: {
          teamId: 1,
          sessionId: 1,
          userId: 1,
          agentRuntime: 1,
          runtimeId: 1,
          claudeCodePreview: 1,
          runtimeMigration: 1,
          archivedAt: 1,
          sessionHomeReclaimedAt: 1,
        },
      },
    )
    .toArray()
  let reclaimed = 0

  for (const conversation of candidates as ReclaimCandidate[]) {
    if (
      conversation.sessionHomeReclaimedAt &&
      conversation.archivedAt &&
      conversation.sessionHomeReclaimedAt >= conversation.archivedAt
    )
      continue
    try {
      if (!(await reclaimSessionHome(conversation))) continue
      await agentConversations().updateOne(
        { sessionId: conversation.sessionId, archivedAt: conversation.archivedAt },
        { $set: { sessionHomeReclaimedAt: now } },
      )
      reclaimed += 1
    } catch (err) {
      logError('agent.session_home_reclaim.failed', err, { session_id: conversation.sessionId })
    }
  }
  if (reclaimed > 0) logEvent('info', 'agent.session_home_reclaim.swept', { reclaimed })

  return reclaimed
}
