// `bun scripts/e2e/run-opencode-signin-models.ts`: OpenCode signed in through Nuphos to a provider
// offers that provider's models in the picker, for the computer's own OpenCode and for one added
// to it. Signs in to Azure with a made-up resource and key: OpenCode lists Azure's models from its
// catalog without calling Azure. OPENCODE names an OpenCode 1.x CLI; nothing reaches Azure.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { startStack } from './stack.ts'

import type { Client } from './binding-access-scenarios.ts'

type Json = Record<string, any>

const opencode = process.env.OPENCODE ?? 'opencode'
// How long the picker may take to show a sign-in: well under the host's 30-minute reread.
const SHOWS_WITHIN_MS = Number(process.env.SHOWS_WITHIN_MS ?? 90_000)
let failed = false

/** Signs OpenCode in to Azure through the app's sign-in, answering each step it asks. */
async function signInAzure(owner: Client, teamId: string, runtimeId: string) {
  const login = `/teams/${teamId}/agent-runtimes/${runtimeId}/login`
  const started = await owner('POST', login)

  must(started.status === 202, `the sign-in to start, got ${String(started.status)} ${started.text}`)
  const { attemptId } = started.body as { attemptId: string }
  const answered = new Set<string>()

  await until(
    'the Azure sign-in to connect',
    async () => {
      const doc = (await owner('GET', login)).body as Json

      if (doc.state === 'failed') throw new Error(`sign-in failed: ${JSON.stringify(doc)}`)
      if (doc.state === 'connected') return true
      const step = doc.step as Json | undefined

      if (!step || doc.codeSubmitted) return false
      const key = JSON.stringify(step)

      if (answered.has(key)) return false
      const message = String(step.message ?? '')
      const code =
        step.kind === 'choose'
          ? 'azure'
          : /resource name/iu.test(message)
            ? 'e2e-fictional-resource'
            : 'e2e-fictional-azure-key-0000000000'
      const sent = await owner('POST', `${login}/code`, { attemptId, code })

      must(sent.status === 200, `the answer to be taken, got ${String(sent.status)} ${sent.text}`)
      answered.add(key)

      return false
    },
    120_000,
  )
}

const azureCount = async (owner: Client, teamId: string, runtimeId: string) => {
  const res = await owner('GET', `/teams/${teamId}/agent-runtimes/${runtimeId}/models`)
  const models = ((res.body as Json).models ?? []) as { id: string }[]

  return { azure: models.filter(({ id }) => id.startsWith('azure/')).length, total: models.length }
}

/** Where a 1.x OpenCode's sign-in landed under the computer's agent home. */
function authFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => file.endsWith(join('opencode', 'auth.json')))
    .filter((file) => !file.includes('session-homes'))
}

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const owner = client(stack.apiUrl, stack.token)
  const computer = await startSecondComputer(stack, 'oc-azure', {
    env: { PATH: `${dirname(opencode)}:${process.env.PATH ?? ''}` },
  })
  const runtimes = async () =>
    (((await owner('GET', `/teams/${stack.teamId}/agent-runtimes`)).body as Json).runtimes ??
      []) as Json[]
  const ours = (r: Json) => r.provider === 'opencode' && String(r.id).includes(computer.deviceId)

  await until('the computer’s own OpenCode to be listed', async () =>
    (await runtimes()).some((r) => ours(r) && r.local?.online),
  )
  const added = await owner('POST', `/agent/devices/${computer.deviceId}/agents`, {
    teamId: stack.teamId,
    provider: 'opencode',
    label: 'Azure OpenAI e2e',
  })

  must(added.status === 201, `OpenCode to be added, got ${String(added.status)} ${added.text}`)
  const instance = added.body as { instanceId: string; runtimeId: string }
  const own = (await runtimes()).find((r) => ours(r) && r.id !== instance.runtimeId)

  must(own, 'the computer’s own OpenCode')
  const cases = [
    { name: 'an added OpenCode, signed in as it is added', runtimeId: instance.runtimeId },
    { name: 'the computer’s own OpenCode, signed in later', runtimeId: String(own.id) },
  ]

  for (const { name, runtimeId } of cases) {
    // The free list first, as the picker shows it before any sign-in.
    await until(`${name} to report its models`, async () =>
      (await azureCount(owner, stack.teamId, runtimeId)).total > 0,
    )
    console.log(`${name}: before sign-in`, await azureCount(owner, stack.teamId, runtimeId))
    await signInAzure(owner, stack.teamId, runtimeId)
    console.log(`${name}: auth files`, authFiles(join(computer.home, '.nuphos-agent')))
    const signedInAt = Date.now()

    try {
      await until(
        `${name} to offer Azure's models`,
        async () => (await azureCount(owner, stack.teamId, runtimeId)).azure > 0,
        SHOWS_WITHIN_MS,
      )
      console.log(`PASS ${name} offers Azure after ${String(Date.now() - signedInAt)} ms`)
    } catch {
      failed = true
      console.log(`FAIL ${name}:`, await azureCount(owner, stack.teamId, runtimeId))
    }
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  if (failed) console.error(`FAIL: logs are in ${artifacts}`)
  await stopAll()
}
process.exit(failed ? 1 : 0)
