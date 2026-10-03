#!/usr/bin/env node
// Drives a running runtime container through its console from the host.
//   fresh volume:   node test/console-smoke.mjs http://127.0.0.1:PORT
//   0.0.x volume:   node test/console-smoke.mjs http://127.0.0.1:PORT --legacy <password>
// The fresh run covers setup, login, pairing, /acp with the issued keys and revoke.
// The legacy run checks that the old password is the console password and still
// opens /acp, with the operator key derived from it.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const [base, flag, legacyPassword] = process.argv.slice(2)
assert(base, 'usage: console-smoke.mjs <base-url> [--legacy <password>]')
const origin = new URL(base).origin
let cookie = ''
let csrf = ''

async function call(method, path, body, extra = {}) {
  const headers = { origin, 'content-type': 'application/json', ...extra }
  if (cookie) headers.cookie = cookie
  if (csrf) headers['x-csrf-token'] = csrf
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: response.status, json, text, headers: response.headers }
}

function openAcp(token) {
  return new Promise((resolve, reject) => {
    const url = base.replace(/^http/, 'ws') + '/acp'
    const ws = new WebSocket(url, [`openab.bearer.${token}`, 'acp.v1'])
    const timer = setTimeout(() => reject(new Error('acp open timed out')), 10_000)
    ws.onopen = () => {
      clearTimeout(timer)
      resolve(ws)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('acp handshake refused'))
    }
  })
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      resolve(message)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

if (flag === '--legacy') {
  assert(legacyPassword, '--legacy needs the password')
  const state = (await call('GET', '/_openab/console/state')).json
  assert.equal(state.phase, 'login', JSON.stringify(state))
  assert.equal(
    (await call('POST', '/_openab/console/login', { password: legacyPassword })).status,
    200,
  )
  const signedIn = (await call('GET', '/_openab/console/state')).json
  assert.equal(signedIn.initializedBy, 'legacy-password')
  assert(signedIn.bindings.some((b) => b.source === 'legacy-password'))
  const transport = await openAcp(legacyPassword)
  await rpc(transport, 1, 'initialize', { protocolVersion: 1 })
  assert.equal((await rpc(transport, 2, '_openab/runtime/state')).error?.code, -32003)
  const control = createHmac('sha256', legacyPassword)
    .update('nuphos-runtime-control-v1')
    .digest('hex')
  const operator = await openAcp(control)
  await rpc(operator, 1, 'initialize', { protocolVersion: 1 })
  assert.notEqual((await rpc(operator, 2, '_openab/runtime/state')).error?.code, -32003)
  transport.close()
  operator.close()
  console.log('console smoke (legacy volume): ok')
  process.exit(0)
}

const page = await call('GET', '/')
assert.equal(page.status, 200)
assert.match(page.text, /Nuphos agent/)
assert.equal(page.headers.get('x-frame-options'), 'DENY')

let state = (await call('GET', '/_openab/console/state')).json
assert.equal(state.phase, 'setup', JSON.stringify(state))

await assert.rejects(openAcp('anything'), /refused/)

const setup = await call('POST', '/_openab/console/setup', { generate: true })
assert.equal(setup.status, 200, setup.text)
const password = setup.json.password
assert(password.length >= 43)
assert.equal((await call('POST', '/_openab/console/setup', { generate: true })).status, 409)

cookie = ''
assert.equal(
  (await call('POST', '/_openab/console/login', { password: 'wrong-password-123' })).status,
  401,
)
assert.equal((await call('POST', '/_openab/console/login', { password })).status, 200)
state = (await call('GET', '/_openab/console/state')).json
assert.equal(state.phase, 'console')
assert(state.initializedAt)
csrf = state.csrfToken

const minted = await call('POST', '/_openab/console/pairing-codes')
assert.equal(minted.status, 200, minted.text)
assert.match(minted.json.code, /^[A-Z2-7]{26}$/)
if (minted.json.deepLink) assert.match(minted.json.deepLink, /^nuphos:\/\/connect-runtime\?url=/)

const exchange = await fetch(`${base}/_openab/pairing/exchange`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: minted.json.code,
    client: { teamName: 'Smoke team', pairedBy: 'Smoke', backendOrigin: 'https://nuphos.test' },
  }),
})
assert.equal(exchange.status, 200)
const issued = await exchange.json()
for (const field of [
  'bindingId',
  'transportKey',
  'controlKey',
  'runtimeInstanceId',
  'pendingUntil',
]) {
  assert.equal(typeof issued[field], 'string', field)
}
const replay = await fetch(`${base}/_openab/pairing/exchange`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: minted.json.code }),
})
assert.equal(replay.status, 400, 'a pairing code is single-use')

const ws = await openAcp(issued.transportKey)
const init = await rpc(ws, 1, 'initialize', { protocolVersion: 1 })
assert(init.result, JSON.stringify(init))
const denied = await rpc(ws, 2, '_openab/runtime/state')
assert.equal(denied.error?.code, -32003)
const operator = await openAcp(issued.controlKey)
await rpc(operator, 1, 'initialize', { protocolVersion: 1 })
const allowed = await rpc(operator, 2, '_openab/runtime/state')
assert.notEqual(allowed.error?.code, -32003, JSON.stringify(allowed))

const self = await fetch(`${base}/_openab/bindings/self`, {
  headers: { authorization: `Bearer ${issued.transportKey}` },
})
assert.equal((await self.json()).state, 'active')

state = (await call('GET', '/_openab/console/state')).json
assert(state.bindings.some((b) => b.id === issued.bindingId && b.client.teamName === 'Smoke team'))

const closed = new Promise((resolve) =>
  ws.addEventListener('close', (event) => resolve(event.code)),
)
const revoked = await call('DELETE', `/_openab/console/bindings/${issued.bindingId}`)
assert.equal(revoked.status, 200, revoked.text)
assert.equal(await closed, 4401)
await assert.rejects(openAcp(issued.transportKey), /refused/)
const gone = await fetch(`${base}/_openab/bindings/self`, {
  headers: { authorization: `Bearer ${issued.controlKey}` },
})
assert.equal(gone.status, 401)
operator.close()

console.log('console smoke: ok')
