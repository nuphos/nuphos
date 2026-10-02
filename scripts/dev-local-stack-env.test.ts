import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  localBackendEnv,
  localRuntimeUrl,
  localStackFromEnv,
  parseEnvFile,
} from './dev-local-stack-env.ts'

const composeEnv = parseEnvFile(`
# comment
S3_ACCESS_KEY=nuphos-local
S3_SECRET_KEY='secret'
RUNTIME_PORT=19000
`)

test('reads the compose .env, defaulting the ports it leaves out', () => {
  assert.deepEqual(localStackFromEnv(composeEnv), {
    mongoPort: 27117,
    rustfsPort: 9000,
    runtimePort: 19000,
    s3AccessKey: 'nuphos-local',
    s3SecretKey: 'secret',
  })
})

test('a compose .env missing a generated secret is not usable', () => {
  assert.equal(localStackFromEnv({ ...composeEnv, S3_SECRET_KEY: '' }), null)
})

test('the backend env points every datastore at the local stack and turns cluster access off', () => {
  const stack = localStackFromEnv(composeEnv)!
  const env = localBackendEnv(stack)

  assert.equal(localRuntimeUrl(stack), 'ws://localhost:19000/acp')
  assert.equal(env.MONGODB_URI, 'mongodb://127.0.0.1:27117/?directConnection=true')
  assert.equal(env.ATLAS_REDIS_ENABLED, 'false')
  assert.equal(env.NUPHOS_LOCAL_STACK, 'true')
  assert.equal(env.CLAUDE_CODE_RUNTIME_KUBECTL, 'false')
  assert.equal(env.CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED, 'false')
  for (const key of [
    'NUPHOS_FILE_TRANSFER_S3_ENDPOINT',
    'ATLAS_SKILLS_S3_ENDPOINT',
    'JOURNAL_S3_ENDPOINT',
  ]) {
    assert.equal(env[key], 'http://127.0.0.1:9000')
  }
})

test('the local launcher overrides inherited TLS and the secondary HTTP listener', () => {
  const env = {
    ATLAS_DEV_TLS_CERT: '/legacy/cert.pem',
    ATLAS_DEV_TLS_KEY: '/legacy/key.pem',
    NUPHOS_DEV_HTTP_PORT: '3818',
    ...localBackendEnv(localStackFromEnv(composeEnv)!),
  }

  assert.equal(env.ATLAS_DEV_TLS_CERT, '')
  assert.equal(env.ATLAS_DEV_TLS_KEY, '')
  assert.equal(env.NUPHOS_DEV_HTTP_PORT, '0')
})
