#!/usr/bin/env bun
// Encrypt Grafana service-account tokens stored in plaintext.
//   bun scripts/encrypt-grafana-tokens.ts [--dry-run]           add encryptedSaToken, keep saToken
//   bun scripts/encrypt-grafana-tokens.ts --unset-plaintext     drop saToken once it is verified
// Run the first form after deploying, and the second only once a rollback is no longer needed.

import { migrateGrafanaTokens } from '../src/lib/byos/grafana-token-migration'
import { closeDb, connectDb } from '../src/lib/db'

const argv = new Set(process.argv.slice(2))
const unknown = [...argv].filter((arg) => arg !== '--dry-run' && arg !== '--unset-plaintext')

if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)

await connectDb()
try {
  const counts = await migrateGrafanaTokens({
    dryRun: argv.has('--dry-run'),
    unsetPlaintext: argv.has('--unset-plaintext'),
  })

  console.log(JSON.stringify({ dryRun: argv.has('--dry-run'), ...counts }))
} finally {
  await closeDb()
}
