import { execFile } from 'node:child_process'

import { LOCAL_AGENT_PROVIDERS, findAgentCli } from './agent-cli.ts'

import type { LocalAgentProvider } from './agent-cli.ts'

const UPDATE_TIMEOUT_MS = 5 * 60_000
const LATEST_TIMEOUT_MS = 10_000
const LATEST_TTL_MS = 60 * 60_000
const NPM_PACKAGE: Record<LocalAgentProvider, string> = {
  'claude-code': '@anthropic-ai/claude-code',
  codex: '@openai/codex',
}

/** `claude update` / `codex update`: each CLI knows how it was installed and updates itself that way. */
export function updateAgentCli(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const file = LOCAL_AGENT_PROVIDERS.includes(provider) ? findAgentCli(provider, env) : null

  if (!file) return Promise.reject(new Error('Install the agent on this computer first.'))

  return new Promise((resolve, reject) => {
    execFile(
      file,
      ['update'],
      { env, timeout: UPDATE_TIMEOUT_MS, shell: file.endsWith('.cmd') },
      (error) => (error ? reject(new Error(error.message)) : resolve()),
    )
  })
}

let latest: { at: number; versions: Promise<Partial<Record<LocalAgentProvider, string>>> } | null =
  null

async function npmLatest(provider: LocalAgentProvider): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE[provider]}/latest`, {
      signal: AbortSignal.timeout(LATEST_TIMEOUT_MS),
    })
    const body = response.ok ? ((await response.json()) as { version?: unknown }) : {}

    return typeof body.version === 'string' ? body.version : undefined
  } catch {
    return
  }
}

/** Each CLI's newest release, for the update hint only: a failure just shows no hint. */
export function latestAgentCliVersions(): Promise<Partial<Record<LocalAgentProvider, string>>> {
  if (!latest || Date.now() - latest.at > LATEST_TTL_MS) {
    const versions = Promise.all(
      LOCAL_AGENT_PROVIDERS.map(async (provider) => [provider, await npmLatest(provider)] as const),
    ).then((entries) => Object.fromEntries(entries.filter(([, version]) => version)))

    latest = { at: Date.now(), versions }
  }

  return latest.versions
}
