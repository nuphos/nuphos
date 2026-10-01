import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { decodeHelmRelease, MAX_HELM_DECOMPRESSED_BYTES } from './helm-release-model.ts'

test('decodes Helm release payloads from Secret and ConfigMap storage', async () => {
  const release = {
    name: 'payments',
    namespace: 'production',
    version: 7,
    chart: { metadata: { name: 'payments', version: '2.4.1', appVersion: '1.9.0' } },
    config: { replicas: 3 },
    manifest: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: payments\n',
  }
  const encoded = gzipSync(JSON.stringify(release)).toString('base64')
  const secretValue = Buffer.from(encoded).toString('base64')

  assert.deepEqual(await decodeHelmRelease('Secret', secretValue), release)
  assert.deepEqual(await decodeHelmRelease('ConfigMap', encoded), release)
})

test('rejects a Helm release whose decompressed payload exceeds the limit', async () => {
  const oversized = gzipSync('x'.repeat(MAX_HELM_DECOMPRESSED_BYTES + 1)).toString('base64')

  await assert.rejects(
    decodeHelmRelease('ConfigMap', oversized),
    /Decompressed Helm release exceeds the supported size limit/,
  )
})
