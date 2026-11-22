// The only replaced boundary: record APNs requests without contacting Apple.
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mock } from 'bun:test'

const modulePath = resolve(import.meta.dirname, '../../apps/backend/src/lib/push/apns.ts')
const apns = await import(modulePath)
const capture = process.env.E2E_PUSH_CAPTURE!

mock.module(modulePath, () => ({
  ...apns,
  apnsCredentials: () => ({
    keyId: 'e2e',
    teamId: 'e2e',
    bundleId: 'ai.nuphos.ios',
    privateKey: 'unused',
    environment: 'sandbox',
  }),
  sendApns: async (_credentials: unknown, request: unknown) => {
    appendFileSync(capture, `${JSON.stringify({ at: Date.now(), request })}\n`)

    return { status: 200 }
  },
}))
