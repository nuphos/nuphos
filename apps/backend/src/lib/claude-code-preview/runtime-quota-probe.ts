import { randomUUID } from 'node:crypto'

import { controlRegistry } from './agent-chat-registry'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

import type { RuntimeInstance } from './runtime-instances'

// Fixed, shell-free program the backend hands to a runtime's `panel` job, which
// is the generic "run this Node program on the agent" job (dashboards use it for
// panel scripts). The runtime signs itself in and Nuphos holds no provider
// token, so only the runtime can read its own credential — this program reads it
// in place, asks the provider for the account's usage windows, and prints one
// sentinel line carrying the provider's response. The credential itself never
// leaves the runtime, and any message that could echo it back is redacted.
//
// The job runs with a cleared environment — the runtime hands it PATH, HOME and
// TMPDIR and nothing else — so HOME is where the agent's own sign-in lives, and
// there is no configuration override to consult.
export const RUNTIME_QUOTA_PROBE = String.raw`
const { readFile } = await import('node:fs/promises');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const SENTINEL = '__NUPHOS_QUOTA__';
const MAX_BODY_CHARS = 200000;
let token = '';
let asked = false;
const safe = text => (token ? String(text).split(token).join('[REDACTED]') : String(text));
const read = path => readFile(path, 'utf8').then(JSON.parse, () => null);

async function lookup() {
  const params = await read(join(process.argv[2] ?? '.', 'params.json'));
  let url;
  let headers;
  let plan;
  if (params && params.provider === 'grok') {
    // Grok reports its own billing over ACP, so its credential stays inside Grok.
    const { spawn } = await import('node:child_process');
    const billing = await new Promise((resolve, reject) => {
      const child = spawn('grok', ['agent', '--no-leader', 'stdio'], {
        env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
      const done = (error, result) => { clearTimeout(timer); child.kill(); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => done(new Error('Grok did not answer')), 10000);
      let buffer = '';
      child.on('error', error => done(error));
      child.stdout.on('data', chunk => {
        buffer += chunk;
        for (let end; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
          let message;
          try { message = JSON.parse(buffer.slice(0, end)); } catch { continue; }
          if (message.id === 1) send({ id: 2, method: '_x.ai/billing', params: {} });
          if (message.id === 2) done(message.error && new Error(message.error.message), message.result);
        }
      });
      send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    }).catch(error => ({ error: String(error.message) }));
    if (billing.error)
      return /Authentication required/.test(billing.error) ? { error: 'Sign in required' } : { error: billing.error.slice(0, 200) };
    asked = true;
    return { usage: billing, ...(typeof billing.subscription_tier === 'string' ? { plan: billing.subscription_tier } : {}) };
  }
  if (params && params.provider === 'codex') {
    const auth = await read(join(homedir(), '.codex', 'auth.json'));
    const tokens = auth && auth.tokens;
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token)
      return { error: 'API-key agents have no usage limits' };
    token = tokens.access_token;
    url = 'https://chatgpt.com/backend-api/wham/usage';
    headers = {
      authorization: 'Bearer ' + token,
      ...(typeof tokens.account_id === 'string' && tokens.account_id ? { 'chatgpt-account-id': tokens.account_id } : {}),
    };
  } else {
    const credentials = await read(join(homedir(), '.claude', '.credentials.json'));
    const oauth = credentials && credentials.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken)
      return { error: 'Sign in required' };
    token = oauth.accessToken;
    if (typeof oauth.subscriptionType === 'string' && oauth.subscriptionType) plan = oauth.subscriptionType;
    url = 'https://api.anthropic.com/api/oauth/usage';
    headers = { authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20' };
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  // Only now: a fetch that never came back is a network failure, not the
  // provider answering, and it costs nothing to ask again soon.
  asked = true;
  if (!response.ok) return { error: 'HTTP ' + response.status, asked: true };
  const body = await response.text();
  if (body.length > MAX_BODY_CHARS) return { error: 'Usage response was too large', asked: true };
  return { usage: JSON.parse(body), ...(plan ? { plan } : {}) };
}

let result;
try {
  result = await lookup();
} catch (error) {
  result = { error: safe(error && error.message ? error.message : error).slice(0, 200), asked };
}
// stdout is a pipe, so the write must land before the process exits.
process.stdout.write(SENTINEL + JSON.stringify(result) + '\n', () => process.exit(0));
`

/** The generic runtime job that runs a Node program on the agent. */
const PROBE_JOB = 'panel'
const PROBE_TIMEOUT_MS = 15_000
/** Catches a runtime that stops answering; the runtime enforces its own timeout. */
const PROBE_CALL_GRACE_MS = 5_000
const PROBE_MAX_STDOUT_BYTES = 256 * 1024

/** The line the probe prints its result on. A test pins it to the program. */
export const RUNTIME_QUOTA_SENTINEL = '__NUPHOS_QUOTA__'

const UNREADABLE = 'The agent reported unreadable usage'
const MAX_REASON_CHARS = 500

/** What the probe reports back: the provider's own usage body, or why it could
 *  not ask. `asked` marks a failure the provider itself answered, which is the
 *  only kind worth holding on to — the rest cost nothing to ask again. */
export type RuntimeQuotaReading =
  { usage?: unknown; plan?: string } | { error: string; asked?: boolean }

export function parseQuotaReading(stdout: string): RuntimeQuotaReading {
  const index = stdout.lastIndexOf(RUNTIME_QUOTA_SENTINEL)

  if (index === -1) return { error: 'The agent reported no usage' }
  const line = stdout.slice(index + RUNTIME_QUOTA_SENTINEL.length).split('\n', 1)[0] ?? ''
  let json: unknown

  try {
    json = JSON.parse(line)
  } catch {
    return { error: UNREADABLE }
  }
  if (!json || typeof json !== 'object') return { error: UNREADABLE }
  const value = json as { error?: unknown; asked?: unknown; usage?: unknown; plan?: unknown }

  // The agent's own reason comes first: a reading that carries one is never a
  // usage body, and both keys are optional, so no schema can tell them apart by
  // shape alone.
  if (typeof value.error === 'string' && value.error)
    return {
      error: value.error.slice(0, MAX_REASON_CHARS),
      ...(value.asked === true ? { asked: true } : {}),
    }
  if (!('usage' in value)) return { error: UNREADABLE }

  return {
    usage: value.usage,
    ...(typeof value.plan === 'string' && value.plan ? { plan: value.plan } : {}),
  }
}

/** Asks the agent that holds the credential; the same path for self-hosted and
 *  Nuphos-hosted agents, because they are the same runtime. */
export async function probeRuntimeQuota(
  teamId: string,
  instance: RuntimeInstance,
): Promise<RuntimeQuotaReading> {
  const endpoints = await resolveTeamRuntimeEndpoints(
    teamId,
    undefined,
    instance.provider,
    'control',
  )
  const endpoint = endpoints.find((candidate) => candidate.runtimeId === instance.id)

  if (!endpoint) return { error: 'Agent is offline' }
  const client = await controlRegistry.acquire(teamId, endpoint)

  if (!controlRegistry.runtimeJobs(teamId, endpoint).includes(PROBE_JOB))
    return { error: 'This agent runs an image that cannot report usage' }
  const raw = await client.runJob(
    {
      jobId: randomUUID(),
      job: PROBE_JOB,
      stdin: JSON.stringify({
        runner: RUNTIME_QUOTA_PROBE,
        script: '',
        params: { provider: instance.provider },
      }),
      env: {},
      timeoutMs: PROBE_TIMEOUT_MS,
      maxStdoutBytes: PROBE_MAX_STDOUT_BYTES,
    },
    PROBE_TIMEOUT_MS + PROBE_CALL_GRACE_MS,
  )

  if (raw.timedOut === true) return { error: 'The agent did not answer in time' }

  return parseQuotaReading(typeof raw.stdout === 'string' ? raw.stdout : '')
}
