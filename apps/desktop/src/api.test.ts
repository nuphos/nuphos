import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apiErrorPhase, decideErrorToast, isNetworkError, isSessionRejected } from './api.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

// These are transient connectivity failures — a failed background refresh must
// NEVER pop a toast for them. If someone edits isNetworkError and drops one of
// these phrasings, CI goes red here instead of the user seeing a stray toast
// (which has now happened enough times to warrant a lock).
const NETWORK_ERRORS = [
  'fetch failed',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'getaddrinfo ENOTFOUND api.nuphos.ai',
  'connect ECONNREFUSED 127.0.0.1:443',
  'read ECONNRESET',
  'connect ETIMEDOUT 52.9.93.56:443',
  'getaddrinfo EAI_AGAIN api.nuphos.ai',
  'The operation was aborted',
  'This operation was aborted due to timeout',
  'Socket timed out',
  // undici fetch timeouts — a family whose messages
  // ("connect timeout error") contain none of the substrings above; they are
  // caught by the "timeout error" phrase.
  'Connect Timeout Error (attempted addresses: 52.9.93.56:443, timeout: 10000ms)',
  'Headers Timeout Error',
  'Body Timeout Error',
  // The real-world shape from the report: an Electron IPC-wrapped connect timeout.
  "Error invoking remote method 'atlas:getMonitoringOverview': Error: Nuphos backend " +
    '/teams/abc/monitoring/overview Connect Timeout Error (attempted addresses: ' +
    '52.9.93.56:443, 52.52.27.1:443, timeout: 10000ms)',
  // Node TLS handshake interrupted mid-connect.
  'Client network socket disconnected before secure TLS connection was established',
  "Error invoking remote method 'atlas:listTeamConnectors': Error: Nuphos backend " +
    '/teams/abc/connectors: Client network socket disconnected before secure TLS ' +
    'connection was established',
  'socket hang up',
]

// Genuine application/server errors — these SHOULD still surface a toast.
const NON_NETWORK_ERRORS = [
  'subscription_required',
  'Team not found',
  'Forbidden',
  'Internal Server Error',
  'Invalid team id',
  'Something went wrong',
  // App-level timeouts that are NOT connectivity failures must still toast.
  // The classifier keys on the "timeout error" phrase, not a bare "timeout",
  // so these stay non-network.
  'Idle session timeout',
  'Query exceeded statement timeout of 30s',
]

test('isNetworkError classifies transient connectivity failures as network errors', () => {
  for (const msg of NETWORK_ERRORS) {
    assert.equal(isNetworkError(new Error(msg)), true, `expected network error: ${msg}`)
  }
})

test('isNetworkError does not swallow genuine application errors', () => {
  for (const msg of NON_NETWORK_ERRORS) {
    assert.equal(isNetworkError(new Error(msg)), false, `expected NOT network error: ${msg}`)
  }
})

test('isNetworkError accepts non-Error inputs', () => {
  assert.equal(isNetworkError('Connect Timeout Error'), true)
  assert.equal(isNetworkError('plain business error'), false)
})

test('apiErrorPhase consolidates connectivity failures but preserves application operations', () => {
  assert.equal(
    apiErrorPhase('agentListConversations', new Error('fetch failed')),
    'network_failure',
  )
  assert.equal(
    apiErrorPhase('agentListConversations', new Error('teamId is required')),
    'agentListConversations',
  )
})

// --- decideErrorToast: the whitelist gate behind toast.apiError -------------
// Toasting is opt-in: only errors the backend deliberately produced (structured
// {code, message} recovered from the atlas sentinel) may show. Everything else
// is suppressed regardless of phrasing — the blacklist above no longer guards
// toasts, so a brand-new transport phrasing can never leak into a toast again.

const sentinel = (payload: Record<string, unknown>) =>
  `__ATLAS_API_ERROR__${JSON.stringify(payload)}`

test('decideErrorToast shows backend-authored business errors', () => {
  for (const e of [
    new Error(sentinel({ message: 'Team not found', code: 'team_not_found' })),
    new Error(sentinel({ message: 'Invalid input', code: 'validation_error', details: {} })),
    // Backend 500s still show: the backend responded, and the message is
    // authored by our own error handler — never transport garbage.
    new Error(sentinel({ message: 'Internal server error', code: 'internal_error' })),
    // Electron IPC wraps the message; the sentinel is embedded mid-string.
    new Error(
      `Error invoking remote method 'atlas:createTeam': Error: ${sentinel({
        message: 'Team not found',
        code: 'team_not_found',
      })}`,
    ),
  ]) {
    const decision = decideErrorToast(e)

    assert.equal(decision.action, 'show', `expected show: ${(e as Error).message}`)
  }
  const shown = decideErrorToast(
    new Error(sentinel({ message: 'Team not found', code: 'team_not_found' })),
  )

  assert.deepEqual(shown, { action: 'show', description: 'Team not found' })
})

test('decideErrorToast surfaces subscription_required (the agent 402 must be visible)', () => {
  const decision = decideErrorToast(
    new Error(sentinel({ message: 'Agent runs need a paid plan.', code: 'subscription_required' })),
  )

  assert.deepEqual(decision, { action: 'show', description: 'Agent runs need a paid plan.' })
})

// A router 404 clears the whitelist (the backend authored it) but means the app
// is calling a route this backend doesn't have — a deployment-skew diagnostic,
// never something the user can act on. It reached a real user as
// "Failed to load databases / Route GET /teams/<id>/database-connections not found".
test('decideErrorToast suppresses router 404s but not missing-record 404s', () => {
  for (const payload of [
    {
      message: 'Route GET /teams/69e989027ab63e8d6a0ffcb6/database-connections not found',
      code: 'route_not_found',
    },
    // Backends released before the route_not_found code.
    { message: 'Route POST /teams/abc/agent/conversations not found', code: 'not_found' },
  ]) {
    assert.deepEqual(
      decideErrorToast(new Error(sentinel(payload))),
      { action: 'suppress', reason: 'unexpected_error' },
      `expected suppress: ${payload.message}`,
    )
  }
  // Handler-raised 404s share the legacy code and must still reach the user.
  for (const message of ['Conversation not found', 'Memory not found', 'Trigger not found']) {
    assert.deepEqual(decideErrorToast(new Error(sentinel({ message, code: 'not_found' }))), {
      action: 'show',
      description: message,
    })
  }
})

test('decideErrorToast suppresses everything without a structured backend code', () => {
  for (const msg of [
    ...NETWORK_ERRORS,
    'Not signed in',
    'HTTP 502',
    '<html>502 Bad Gateway</html>',
    'Internal Server Error',
    'Something went wrong',
  ]) {
    const decision = decideErrorToast(new Error(msg))

    assert.deepEqual(
      decision,
      { action: 'suppress', reason: 'unexpected_error' },
      `expected suppress: ${msg}`,
    )
  }
})

test('decideErrorToast accepts non-Error inputs', () => {
  assert.equal(decideErrorToast('fetch failed').action, 'suppress')
  assert.equal(decideErrorToast(sentinel({ message: 'Nope', code: 'forbidden' })).action, 'show')
})

test('isSessionRejected is true only for a refused session, never for a denied request', () => {
  assert.equal(
    isSessionRejected(
      new Error(sentinel({ message: 'Invalid or expired token', code: 'unauthorized' })),
    ),
    true,
  )
  assert.equal(
    isSessionRejected(
      new Error(sentinel({ message: 'You are not a member of this team', code: 'forbidden' })),
    ),
    false,
  )
  assert.equal(isSessionRejected(new Error('fetch failed')), false)
})
