// A Task linked to a pull request wakes once when CI for the head settles, not once per
// check suite (#4748), on a real backend, Redis queue and OpenAB runtime. GitHub is a stub.
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { artifacts, freePorts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const { MongoClient, ObjectId } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
const SECRET = randomUUID()
const head = 'c'.repeat(40)
const run = (id: number, name: string, status: string) => ({
  id,
  name,
  status,
  conclusion: status === 'completed' ? 'success' : null,
})
let checkRuns = [run(1, 'Backend', 'completed'), run(2, 'Desktop', 'in_progress')]
let failed = false

const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failed = true
}

const [githubPort] = await freePorts(1)
const github = Bun.serve({
  port: githubPort,
  hostname: '127.0.0.1',
  fetch: (request) => {
    const path = new URL(request.url).pathname

    console.log(`GitHub stub: ${request.method} ${path}`)

    if (path.endsWith('/access_tokens'))
      return Response.json({ token: 'e2e-token', expires_at: '2099-01-01T00:00:00Z' })
    if (path === '/repos/acme/app/pulls/7')
      return Response.json({ state: 'open', mergeable_state: 'clean', head: { sha: head } })
    if (path.endsWith('/check-runs')) return Response.json({ check_runs: checkRuns })
    if (path.endsWith('/status'))
      return Response.json({ state: 'pending', total_count: 0, statuses: [] })
    if (path.endsWith('/reviews')) return Response.json([])

    return Response.json({ message: 'Not Found' }, { status: 404 })
  },
})

try {
  console.log(`Artifacts: ${artifacts}`)
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const stack = await startStack({
    redis: true,
    backendStub: {
      preload: resolve(import.meta.dirname, 'github-api-stub.ts'),
      env: {
        E2E_GITHUB_API: `http://127.0.0.1:${String(githubPort)}`,
        GITHUB_APP_ID: '1',
        GITHUB_APP_SLUG: 'nuphos-e2e',
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
        GITHUB_APP_WEBHOOK_SECRET: SECRET,
      },
    },
  })
  const as = client(stack.apiUrl, stack.token)
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const db = mongo.db('nuphos_e2e')
  const id = randomUUID()
  const started = await as('POST', '/agent/chat', {
    id,
    teamId: stack.teamId,
    messages: [
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hi E2E_DELIVERY:start' }] },
    ],
  })

  must(started.status === 200, `chat to start, got ${started.status}`)
  // The PR is linked through an installation the Task may use, as bind_session_resource leaves it.
  await db.collection('team_byos_bindings').updateOne(
    { _id: new ObjectId(stack.teamId) },
    {
      $push: {
        githubInstallations: {
          id: new ObjectId(),
          installationId: 77,
          accountLogin: 'acme',
          accountType: 'Organization',
          accountId: 1,
          targetType: 'all',
          createdAt: new Date(),
        },
      },
    },
    { upsert: true },
  )
  await db.collection('agent_conversations').updateOne(
    { sessionId: id },
    {
      $set: {
        'credentialAccess.githubInstallationIds': ['77'],
        linkedResources: [
          {
            id: 'pr',
            key: 'github/77/34/7',
            provider: 'github',
            integrationId: '77',
            repository: 'acme/app',
            number: 7,
            title: 'A change',
            url: 'https://github.com/acme/app/pull/7',
            state: 'open',
          },
        ],
      },
    },
  )
  const suiteDone = async (delivery: string) => {
    const body = JSON.stringify({
      action: 'completed',
      installation: { id: 77 },
      repository: { id: 34, full_name: 'acme/app' },
      sender: { type: 'Bot', login: 'github-actions[bot]' },
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        head_sha: head,
        pull_requests: [{ number: 7 }],
      },
    })
    const signature = createHmac('sha256', SECRET).update(body).digest('hex')
    const response = await fetch(`${stack.apiUrl}/github-app/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'check_suite',
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    })

    must(response.status === 204, `the webhook to be accepted, got ${response.status}`)
  }
  const wakes = async () =>
    (await db.collection('agent_messages').find({ sessionId: id, role: 'user' }).toArray())
      .map((message) => JSON.stringify(message))
      .filter((message) => message.includes('GitHub '))

  // The Backend workflow's suite finishes while Desktop is still running, then Desktop's and
  // a third workflow's suites finish on the settled head.
  await suiteDone(randomUUID())
  checkRuns = [run(1, 'Backend', 'completed'), run(2, 'Desktop', 'completed')]
  await suiteDone(randomUUID())
  await suiteDone(randomUUID())
  await until('the Task to be woken', async () => (await wakes()).length > 0)
  // Room for any further wake the queue still holds to arrive.
  await Bun.sleep(15_000)
  const woken = await wakes()

  console.log(`Wakes: ${String(woken.length)}`)
  check('three finished suites woke the Task once', woken.length === 1)
  check(
    'the wake says CI for the head passed',
    woken[0]?.includes('GitHub CI finished on ccccccc: passed.') ?? false,
  )
  await mongo.close()
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await github.stop(true)
  await stopAll()
}
process.exit(failed ? 1 : 0)
