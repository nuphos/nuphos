import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db/shared'
import { isLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { logError, logEvent } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { developmentRuntimeEndpoint } from './runtime-catalog'
import { SESSION_TTL_HOURS } from './runtime-objects'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { conversationExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db/shared'
import type { Filter } from 'mongodb'

// Removes the conversation's CLI homes that apps/runtime/image/session-home.mjs
// creates: <runtime HOME>/.nuphos/session-homes/<sha256(sessionId)> for the
// owner and <sha256(sessionId)>.<sha256(actor)> for each teammate, unless a
// process still runs with that HOME or inside it (a turn that just started, or
// a shell left running). The next session start recreates a home.
// Request data is JSON, never interpolated into executable code or a shell.
export const RECLAIM_SESSION_HOME_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { createHash, randomUUID } = await import('node:crypto');
const { sessionId } = JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'));
if (typeof sessionId !== 'string' || !sessionId.trim()) process.exit(2);
const id = createHash('sha256').update(sessionId).digest('hex');
const homes = path.join(os.homedir(), '.nuphos', 'session-homes');
let unreadable;
const done = (result) => { process.stdout.write(JSON.stringify({ result, unreadable })); process.exit(0); };
// Processes of this user, each marked whether it is inside the runtime's tree:
// descendants of the topmost ancestor of this job that runs as the same user
// (tini in the image). The parent pid in /proc/<pid>/stat is readable for every
// process, so the tree is known even where environ is not. A session process
// can also sit outside it: an orphan adopted by a root pid 1 (Railway).
const userProcesses = async () => {
  const parent = new Map();
  for (const pid of await fs.readdir('/proc')) {
    const stat = /^\d+$/.test(pid) && (await fs.readFile('/proc/' + pid + '/stat', 'utf8').catch(() => ''));
    if (stat) parent.set(pid, stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  const sameUser = async (pid) => (await fs.stat('/proc/' + pid).catch(() => null))?.uid === process.getuid();
  let root = String(process.pid);
  for (let pid = parent.get(root); pid && pid !== '0' && (await sameUser(pid)); pid = parent.get(pid)) root = pid;
  const descends = (pid) => {
    for (let at = pid; at && at !== '0'; at = parent.get(at)) if (at === root) return true;
    return false;
  };
  const found = [];
  for (const pid of parent.keys()) if (await sameUser(pid)) found.push([pid, descends(pid)]);
  return found;
};
// HOME is matched by the original path; a working directory follows the
// directory itself.
const inUse = async (dir, byHome) => {
  for (const [pid, inTree] of await userProcesses()) {
    // No working directory: the process has exited, possibly an unreaped
    // zombie whose environ is unreadable. An unreadable process in the
    // runtime's tree counts as a user, since keeping a home is always safe;
    // one outside it (a host's systemd --user) is not a session.
    const cwd = await fs.readlink('/proc/' + pid + '/cwd').catch((err) => (err.code === 'ENOENT' || err.code === 'ESRCH' ? null : ''));
    if (cwd === null) continue;
    const env = await fs.readFile('/proc/' + pid + '/environ', 'utf8').catch(() => null);
    if (env === null || cwd === '') {
      if (!inTree) continue;
      const comm = await fs.readFile('/proc/' + pid + '/comm', 'utf8').catch(() => '?');
      unreadable = pid + ' ' + comm.trim();
      return true;
    }
    if (env.split('\0').includes('HOME=' + byHome) || cwd === dir || cwd.startsWith(dir + '/')) return true;
  }
  return false;
};
const names = await fs.readdir(homes).catch(() => []);
// A job killed during the rm, or a failed rename back, leaves a home's
// <home>.reclaim-<ms>-* behind; its next reclaim removes it once nothing uses it.
// One younger than any job may still belong to a running job, so it waits.
const leftover = new RegExp('^(' + id + '(?:\\.[0-9a-f]{64})?)\\.reclaim-([0-9]+)-');
for (const name of names) {
  const match = leftover.exec(name);
  if (!match || !(Date.now() - Number(match[2]) > 10 * 60_000)) continue;
  const left = path.join(homes, name);
  if (!(await inUse(left, path.join(homes, match[1])))) await fs.rm(left, { recursive: true, force: true }).catch(() => {});
}
const reclaim = async (home) => {
  if (!(await fs.lstat(home).catch(() => null))) return 'absent';
  if (await inUse(home, home)) return 'in_use';
  // Set aside first: a session that starts now gets a fresh home, and one that
  // started during the scan is caught by the second scan and keeps this one.
  const aside = home + '.reclaim-' + Date.now() + '-' + randomUUID();
  // Gone since the check: another backend replica's sweep took it first.
  const moved = await fs.rename(home, aside).then(() => true, (err) => (err.code === 'ENOENT' ? false : Promise.reject(err)));
  if (!moved) return 'absent';
  if (await inUse(aside, home)) { await fs.rename(aside, home).catch(() => {}); return 'in_use'; }
  await fs.rm(aside, { recursive: true, force: true });
  return 'removed';
};
const teammates = names.filter((name) => new RegExp('^' + id + '\\.[0-9a-f]{64}$').test(name));
const results = [];
for (const name of [id, ...teammates]) results.push(await reclaim(path.join(homes, name)));
done(results.includes('in_use') ? 'in_use' : results.includes('removed') ? 'removed' : 'absent');
`

const RETRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

// Conversations whose home is no longer needed: archived ones, and trigger runs
// nobody archives once the runtime has ended their inner session for idleness.
function reclaimableFilter(now: Date, since = new Date(0)): Filter<AgentConversation> {
  return {
    $or: [
      { archivedAt: { $gt: since } },
      {
        'metadata.trigger.id': { $exists: true },
        lastActiveAt: {
          $lte: new Date(now.getTime() - SESSION_TTL_HOURS * 60 * 60 * 1000),
          $gt: since,
        },
      },
    ],
  }
}

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
  | 'lastActiveAt'
> & { sessionHomeReclaimedAt?: Date } // Set once the home is gone since it became reclaimable.

const RECLAIM_PROJECTION = {
  teamId: 1,
  sessionId: 1,
  userId: 1,
  agentRuntime: 1,
  runtimeId: 1,
  claudeCodePreview: 1,
  runtimeMigration: 1,
  archivedAt: 1,
  lastActiveAt: 1,
}

/**
 * Removes a reclaimable conversation's CLI home once the runtime reports no live
 * session for it. Returns false to have a later sweep retry: still reclaimable
 * but in use, or the runtime is unreachable right now. Agents on someone's own
 * computer are not reached; their disk is theirs.
 */
export async function reclaimSessionHome(sessionId: string, now = new Date()): Promise<boolean> {
  // Re-read now: the sweep can run long, and a restored or resumed conversation keeps its home.
  const conversation = (await agentConversations().findOne(
    { sessionId, ...reclaimableFilter(now) },
    { projection: RECLAIM_PROJECTION },
  )) as ReclaimCandidate | null

  if (!conversation) return false
  const { teamId, runtimeId, agentRuntime: provider = 'claude-code' } = conversation

  if (!teamId || !runtimeId || isLocalRuntimeId(runtimeId)) return true
  const endpoint =
    runtimeId === `development-${provider}`
      ? developmentRuntimeEndpoint(provider, 'control')
      : (await resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control')).find(
          (item) => item.runtimeId === runtimeId,
        )

  if (!endpoint) return false
  // Only the runtime knows whether its inner session (and any async task) is live.
  if ((await conversationExecutionState(conversation)).state !== 'dormant') return false
  const client = await controlRegistry.acquire(teamId, endpoint)

  if (!controlRegistry.runtimeJobs(teamId, endpoint).includes('panel')) return false
  const result = await client.runJob(
    {
      jobId: randomUUID(),
      job: 'panel',
      env: {},
      stdin: JSON.stringify({
        runner: RECLAIM_SESSION_HOME_PROGRAM,
        script: '',
        params: { sessionId },
      }),
      timeoutMs: 60_000,
      maxStdoutBytes: 1024,
    },
    65_000,
  )

  if (result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string')
    throw new Error(`Reclaiming the session home failed: ${JSON.stringify(result)}`)

  const outcome = JSON.parse(result.stdout) as { result?: string; unreadable?: string }

  // Kept because a process could not be inspected; a host where this repeats
  // never reclaims anything.
  if (outcome.unreadable)
    logEvent('warn', 'agent.session_home_reclaim.unreadable_process', {
      session_id: sessionId,
      process: outcome.unreadable,
    })

  return outcome.result !== 'in_use'
}

/**
 * Hourly: reclaimable conversations whose home is not reclaimed since they
 * became reclaimable. One that is still running is retried on the next sweep.
 */
export async function reclaimSessionHomes(now = new Date()): Promise<number> {
  const candidates = (await agentConversations()
    .find(reclaimableFilter(now, new Date(now.getTime() - RETRY_WINDOW_MS)), {
      projection: { sessionId: 1, archivedAt: 1, lastActiveAt: 1, sessionHomeReclaimedAt: 1 },
    })
    .toArray()) as ReclaimCandidate[]
  let reclaimed = 0

  for (const conversation of candidates) {
    // An unarchived trigger run counts from its last turn; a later turn reclaims again.
    const at = conversation.archivedAt ?? conversation.lastActiveAt
    const since = conversation.archivedAt ? { archivedAt: at } : { lastActiveAt: at }

    if (conversation.sessionHomeReclaimedAt && conversation.sessionHomeReclaimedAt >= at) continue
    try {
      if (!(await reclaimSessionHome(conversation.sessionId, now))) continue
      await agentConversations().updateOne(
        { sessionId: conversation.sessionId, ...since },
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
