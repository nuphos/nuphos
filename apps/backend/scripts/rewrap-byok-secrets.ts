#!/usr/bin/env bun
// Re-seal stored BYOK credentials with the current key after a key rotation.
//   bun scripts/rewrap-byok-secrets.ts --dry-run   count what would change
//   bun scripts/rewrap-byok-secrets.ts             rewrite them
//
// Rotation: set <KEY> to the new key and <KEY>_PREVIOUS to the old one, deploy,
// run this until it reports no failed or raced envelopes, wait out the OAuth
// pending TTLs, then remove <KEY>_PREVIOUS and deploy again.

import { rewrapByokSecrets } from '../src/lib/byos/rewrap'
import { closeDb, connectDb } from '../src/lib/db'

const argv = new Set(process.argv.slice(2))
const unknown = [...argv].filter((arg) => arg !== '--dry-run')

if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)

await connectDb()
try {
  const counts = await rewrapByokSecrets({ dryRun: argv.has('--dry-run') })

  console.log(JSON.stringify({ dryRun: argv.has('--dry-run'), ...counts }))
} finally {
  await closeDb()
}
