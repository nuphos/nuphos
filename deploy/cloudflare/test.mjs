import assert from 'node:assert/strict'
import { test } from 'node:test'
import { containerEnv } from './src/config.ts'

const settings = {
  MONGODB_URI: 'mongodb+srv://example.com/nuphos',
  NUPHOS_JWT_SECRET: 'test-jwt-secret',
  NUPHOS_PUBLIC_BACKEND_URL: 'https://api.example.com',
  ZSEND_API_KEY: 'test-email-key',
  NUPHOS_EMAIL_FROM: 'test@example.com',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-access',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_TRANSFER_BUCKET: 'transfers',
  R2_SKILLS_BUCKET: 'skills',
}

test('R2 credentials reach both S3 clients without forwarding unrelated Worker bindings', () => {
  const env = containerEnv({ ...settings, CLOUDFLARE_API_TOKEN: 'must-not-leak' })
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined)
  assert.equal(env.NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY, settings.R2_SECRET_ACCESS_KEY)
  assert.equal(env.ATLAS_SKILLS_S3_SECRET_ACCESS_KEY, settings.R2_SECRET_ACCESS_KEY)
  assert.equal(env.NUPHOS_FILE_TRANSFER_S3_REGION, 'auto')
  assert.equal(env.ATLAS_REDIS_ENABLED, 'false')
  assert.equal(env.NODE_ENV, 'production')
  assert.equal(env.NUPHOS_DEV_EMAIL_OTP_LOG, undefined)
})

test('missing inputs and insecure or path-prefixed public URLs fail closed', () => {
  assert.throws(() => containerEnv({ ...settings, MONGODB_URI: '' }), /MONGODB_URI/)
  for (const url of [
    'http://api.example.com',
    'https://api.example.com/path',
    'https://user:pass@api.example.com',
  ]) {
    assert.throws(
      () => containerEnv({ ...settings, NUPHOS_PUBLIC_BACKEND_URL: url }),
      /HTTPS origin/,
    )
  }
})
