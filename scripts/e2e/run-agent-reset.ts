// Resetting an added agent signs it out but keeps it (#2648): its credentials go, here and in
// each conversation's home, and it signs in again. Its own stack with Redis, so this script asks
// for the reset as a backend replica does, since no route asks for one yet. All fictional.
import { execFile } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { backendFailures } from './backend-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { startStack } from './stack.ts'

import type { Client } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const LOCAL_RUNTIME = join(BACKEND_DIR, 'src', 'lib', 'agent', 'devices', 'local-runtime')

type Added = { instanceId: string; runtimeId: string }
type Cli = { installed: boolean; loggedIn: boolean | null } | null
type Computer = { ownerId: string; deviceId: string; agentHome: string }

/** The credential files each agent's home holds once signed in, as agent-credentials.ts names them. */
const CREDENTIALS = {
  'claude-code': ['.credentials.json', '.nuphos-oauth-token.json'],
  codex: ['auth.json', '.nuphos-auth-revision'],
} as const

type Provider = keyof typeof CREDENTIALS

const CLAUDE: Provider = 'claude-code'

// As a backend replica does it: the computer's tunnel is reached through Redis, wherever it is held.
const REPLICA = `
  import { commitLocalAgentInstance, resetLocalAgentInstance } from '${LOCAL_RUNTIME}/instances.ts'
  import { runtimePresenceStore } from '${LOCAL_RUNTIME}/presence.ts'
  const [action, userId, deviceId, teamId, instanceId] = process.argv.slice(1)
  const target = { userId, actorId: userId, deviceId, teamId }
  try {
    if (action === 'status') {
      const presence = await runtimePresenceStore().get(userId, deviceId)
      const found = presence?.status?.instances?.find((entry) => entry.instanceId === instanceId)
      console.log(JSON.stringify(found?.cli ?? null))
    } else if (action === 'reset') await resetLocalAgentInstance(target, { instanceId })
    else await commitLocalAgentInstance(target, { instanceId })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  process.exit(0)`

/** Runs `action` for the agent as the backend does; throws with the host's answer if refused. */
async function asBackend(
  stack: Stack,
  computer: Computer,
  action: 'reset' | 'commit' | 'status',
  { instanceId }: Added,
): Promise<string> {
  const { stdout } = await promisify(execFile)(
    'bun',
    ['-e', REPLICA, action, computer.ownerId, computer.deviceId, stack.teamId, instanceId],
    { cwd: BACKEND_DIR, env: { ...process.env, ...stack.backendEnv }, timeout: 60_000 },
  )

  return stdout.trim()
}

/** What the computer last reported of the agent's CLI, as the backend holds it. */
const cliOf = async (stack: Stack, computer: Computer, agent: Added): Promise<Cli> =>
  JSON.parse((await asBackend(stack, computer, 'status', agent)) || 'null') as Cli

const homeOf = (computer: Computer, provider: Provider, { instanceId }: Added) =>
  join(
    computer.agentHome,
    'instances',
    instanceId,
    'users',
    computer.ownerId,
    provider === CLAUDE ? 'claude-home' : `${provider}-home`,
  )

/** Claude Code signs in through the app's sign-in: Claude's authorize page, then its code. */
async function signInClaude(stack: Stack, owner: Client, agent: Added) {
  const login = `/teams/${stack.teamId}/agent-runtimes/${agent.runtimeId}/login`
  const started = await owner('POST', login)

  must(
    started.status === 202,
    `the sign-in to start, got ${String(started.status)} ${started.text}`,
  )
  const { attemptId } = started.body as { attemptId: string }
  const state = async () => ((await owner('GET', login)).body as { state?: string }).state

  await until(
    'Claude to show its authorize page',
    async () => (await state()) === 'awaiting_authorization',
  )
  const sent = await owner('POST', `${login}/code`, { attemptId, code: 'e2e-code#e2e-state' })

  must(sent.status === 200, `the code to be taken, got ${String(sent.status)} ${sent.text}`)
  await until('the sign-in to connect', async () => (await state()) === 'connected')
}

/** Codex's own sign-in is a device code at OpenAI, so it is left as `codex login` leaves it. */
async function signInCodex(stack: Stack, computer: Computer, agent: Added) {
  const home = homeOf(computer, 'codex', agent)

  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: 'e2e' } }))
  writeFileSync(join(home, '.nuphos-auth-revision'), '1')
  // As the app's sign-in ends: the host checks the login and keeps the agent.
  await asBackend(stack, computer, 'commit', agent)
}

const signedIn = (stack: Stack, computer: Computer, agent: Added, loggedIn: boolean) =>
  until(`the agent to be reported ${loggedIn ? 'signed in' : 'signed out'}`, async () => {
    const cli = await cliOf(stack, computer, agent)

    return cli?.installed === true && cli.loggedIn === loggedIn
  })

/** Each credential, in the agent's home and in two conversations' homes, which mirror it. */
function credentialFiles(computer: Computer, provider: Provider, agent: Added): string[] {
  const home = homeOf(computer, provider, agent)
  const sessions = ['e2e-session-a', 'e2e-session-b'].map((name) =>
    join(home, '.nuphos', 'session-homes', name),
  )

  return [home, ...sessions].flatMap((at) => CREDENTIALS[provider].map((file) => join(at, file)))
}

/** Puts each credential file in the home, and a copy in each conversation's home beside its history. */
function mirrorIntoSessions(computer: Computer, provider: Provider, agent: Added) {
  const home = homeOf(computer, provider, agent)

  for (const name of CREDENTIALS[provider])
    if (!existsSync(join(home, name))) writeFileSync(join(home, name), '{"e2e":true}')
  for (const file of credentialFiles(computer, provider, agent)) {
    const dir = dirname(file)

    if (dir === home) continue
    mkdirSync(dir, { recursive: true })
    copyFileSync(join(home, basename(file)), file)
    writeFileSync(join(dir, 'history.jsonl'), '{"kept":true}\n')
  }
}

async function resetFlow(
  stack: Stack,
  owner: Client,
  computer: Computer,
  provider: Provider,
): Promise<void> {
  const added = await owner('POST', `/agent/devices/${computer.deviceId}/agents`, {
    teamId: stack.teamId,
    provider,
  })

  must(added.status === 201, `${provider} to be added, got ${String(added.status)} ${added.text}`)
  const agent = added.body as Added

  await until(
    `the computer to list the added ${provider}`,
    async () => (await cliOf(stack, computer, agent))?.installed,
  )
  if (provider === CLAUDE) await signInClaude(stack, owner, agent)
  else await signInCodex(stack, computer, agent)
  await signedIn(stack, computer, agent, true)
  console.log(`PASS ${provider} is added and signed in`)

  const home = homeOf(computer, provider, agent)
  const settings = join(home, 'settings.json')

  if (provider === CLAUDE) {
    const own = JSON.parse(readFileSync(settings, 'utf8')) as { env?: Record<string, string> }

    writeFileSync(
      settings,
      JSON.stringify({ ...own, env: { ...own.env, ANTHROPIC_API_KEY: 'e2e' } }),
    )
  }
  mirrorIntoSessions(computer, provider, agent)
  const files = credentialFiles(computer, provider, agent)

  must(
    files.every((file) => existsSync(file)),
    'each credential to be there before the reset',
  )

  // The reset, as the backend asks for it: the host answers once it is done.
  await asBackend(stack, computer, 'reset', agent)
  console.log(`PASS the computer reports the ${provider} reset done`)
  const left = files.filter((file) => existsSync(file))

  must(left.length === 0, `every credential to be deleted, left: ${left.join(', ')}`)
  must(
    existsSync(join(home, '.nuphos', 'session-homes', 'e2e-session-a', 'history.jsonl')),
    "a conversation's own files to be kept",
  )
  if (provider === CLAUDE) {
    // The host writes its settings afresh on each start, keeping only an API key there.
    const kept = JSON.parse(readFileSync(settings, 'utf8')) as { env?: Record<string, string> }

    must(!kept.env?.ANTHROPIC_API_KEY, 'the API key in its settings to go, the settings staying')
  }
  console.log(`PASS ${provider}'s credentials are gone, here and in each conversation's home`)
  await signedIn(stack, computer, agent, false)
  console.log(`PASS ${provider} comes back signed out`)

  if (provider === CLAUDE) await signInClaude(stack, owner, agent)
  else await signInCodex(stack, computer, agent)
  await signedIn(stack, computer, agent, true)
  console.log(`PASS ${provider} signs in again after the reset`)
}

let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ redis: true })
  const owner = client(stack.apiUrl, stack.token)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''
  const fixture = (name: string) => resolve(import.meta.dirname, name)
  let agentHome = ''
  // Both CLIs are there already, so adding them installs nothing.
  const computer = await startSecondComputer(stack, 'E2E reset mini', {
    prepare: (home, dataDir) => {
      const bin = join(home, '.local', 'bin')

      agentHome = dataDir
      mkdirSync(bin, { recursive: true })
      copyFileSync(fixture('fixture-claude.mjs'), join(bin, 'claude'))
      copyFileSync(fixture('fixture-codex.mjs'), join(bin, 'codex'))
      chmodSync(join(bin, 'claude'), 0o755)
      chmodSync(join(bin, 'codex'), 0o755)
    },
  })
  const target = { ownerId, deviceId: computer.deviceId, agentHome }

  await resetFlow(stack, owner, target, CLAUDE)
  await resetFlow(stack, owner, target, 'codex')
  const failures = backendFailures(0)

  must(failures.length === 0, `no unexpected backend failures:\n${failures.join('\n')}`)
  await computer.stop()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
