import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createRailwayContext, project } from 'railway/iac'
import dataTemplate from './.railway/railway.ts'
import runtimeTemplate from './.railway/runtime.ts'

Object.assign(process.env, {
  API_DOMAIN: 'api.example.com',
  STORAGE_DOMAIN: 'storage.example.com',
  MONGO_PASSWORD: 'test-password@with:reserved/characters',
  STORAGE_SECRET: 'test-storage',
  JWT_SECRET: 'test-jwt',
  ZSEND_API_KEY: 'test-email',
  NUPHOS_EMAIL_FROM: 'test@example.com',
  RUNTIME_DOMAIN: 'runtime.example.com',
  RUNTIME_PASSWORD: 'test-runtime-password-with-32-characters',
})
const context = createRailwayContext({ environment: 'production' })

test('data project keeps Mongo private, persistent, authenticated and Redis-free', async () => {
  const result = await dataTemplate(context, project)
  const services = result.resources.filter((r) => r.type === 'service')
  assert.deepEqual(
    services.map((r) => r.name),
    ['mongo', 'storage', 'backend'],
  )
  const [mongo, storage, backend] = services
  assert.equal(mongo.variables.MONGO_INITDB_ROOT_PASSWORD.value, process.env.MONGO_PASSWORD)
  assert.equal(mongo.volumeAttachments['mongo-data'].mountPath, '/data')
  assert.equal(mongo.networking, undefined)
  assert.equal(backend.variables.ATLAS_REDIS_ENABLED.value, 'false')
  assert.match(
    backend.variables.MONGODB_URI.value,
    /test-password%40with%3Areserved%2Fcharacters@\$\{\{mongo.RAILWAY_PRIVATE_DOMAIN\}\}/,
  )
  for (const service of [mongo, storage]) {
    const checked = spawnSync('/bin/sh', ['-n', '-c', service.deploy.startCommand], {
      encoding: 'utf8',
    })
    assert.equal(checked.status, 0, checked.stderr)
  }
  assert.match(mongo.deploy.startCommand, /--ipv6/)
})

test('runtime is a separate project with only runtime variables and a home volume', async () => {
  const result = await runtimeTemplate(context, project)
  assert.equal(result.name, 'nuphos-runtime')
  const [runtime] = result.resources
  assert.deepEqual(Object.keys(runtime.variables).sort(), [
    'OPENAB_ACP_AUTH_KEY',
    'OPENAB_STREAM_EDIT_INTERVAL_MS',
    'PORT',
  ])
  assert.deepEqual(
    Object.values(runtime.volumeAttachments).map((v) => v.mountPath),
    ['/home/node'],
  )
  assert.equal(result.resources.filter((r) => r.type === 'service').length, 1)
})

test('missing deployment inputs fail before contacting Railway', async () => {
  const saved = process.env.ZSEND_API_KEY
  delete process.env.ZSEND_API_KEY
  assert.throws(() => dataTemplate(context, project), /ZSEND_API_KEY/)
  process.env.ZSEND_API_KEY = saved
})
