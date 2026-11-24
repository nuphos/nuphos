// Real backend for Android's VoiceTranscriptionLiveDeviceTest (#1049), with a stand-in Whisper that answers with the
// size and SHA-256 of the audio it got, never OpenAI. Writes `$E2E_ARTIFACTS/voice.json` (the test's arguments; reach
// the port with `adb reverse`) and stays up until `$E2E_ARTIFACTS/done` exists.
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { artifacts, freePorts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const [whisperPort] = await freePorts(1)
const whisper = Bun.serve({
  hostname: '127.0.0.1',
  port: whisperPort,
  async fetch(request) {
    const form = await request.formData()
    const file = form.get('file')

    if (new URL(request.url).pathname !== '/v1/audio/transcriptions' || !(file instanceof File))
      return Response.json({ error: { message: 'not a transcription' } }, { status: 400 })
    const audio = new Uint8Array(await file.arrayBuffer())
    const sha = createHash('sha256').update(audio).digest('hex')

    return Response.json({
      text: `Heard ${String(audio.length)} bytes ${sha.slice(0, 16)} as ${String(form.get('model'))}`,
      language: 'english',
    })
  },
})

const stack = await startStack({
  backendStub: {
    preload: resolve(import.meta.dirname, 'cli-release-stub.ts'),
    env: { OPENAI_BASE_URL: `http://127.0.0.1:${String(whisperPort)}/v1` },
  },
})

// The phone app reads AI features only after its user accepted their terms (AccountApi.AI_CONSENT_VERSION).
const consent = await fetch(`${stack.apiUrl}/auth/ai-consent`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ version: '2026-11-23', accepted: true }),
})

if (!consent.ok) throw new Error(`Consent answered ${String(consent.status)}`)

// The stack runs with a billing service, so the team needs a plan of its own to transcribe.
const plan = Bun.spawnSync(
  [
    'bun',
    '-e',
    `import { MongoClient, ObjectId } from 'mongodb'
     const client = await MongoClient.connect(process.argv[1])
     await client.db('nuphos_e2e').collection('teams').updateOne({ _id: new ObjectId(process.argv[2]) }, { $set: { boxVcpuLimit: 2 } })
     await client.close()`,
    stack.mongoUri,
    stack.teamId,
  ],
  { cwd: resolve(import.meta.dirname, '../../apps/backend'), stderr: 'inherit' },
)

if (plan.exitCode !== 0) throw new Error('Could not give the E2E team a plan')

writeFileSync(
  join(artifacts, 'voice.json'),
  JSON.stringify({ port: new URL(stack.apiUrl).port, token: stack.token, teamId: stack.teamId }),
)
console.log(`ready: ${join(artifacts, 'voice.json')}`)
await until('the device test to finish', async () => existsSync(join(artifacts, 'done')), 3_600_000)
await whisper.stop()
stopAll()
process.exit(0)
