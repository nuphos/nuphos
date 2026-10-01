// A rejected response_url post answers HTTP 200 and puts the outcome in the
// body. Treating the status alone as success made a failed interaction reply
// completely silent — no log, and the user's click appeared to do nothing.
//
// Tests the predicate rather than postSlackResponseUrl itself: other suites
// partially mock '@/lib/slack/api', which is process-global in Bun, so a test
// that called the real network function passed alone and failed in the suite.
import { describe, expect, test } from 'bun:test'

import { isSlackResponseUrlAck } from './api'

describe('isSlackResponseUrlAck', () => {
  test('accepts what Slack returns on success', () => {
    expect(isSlackResponseUrlAck('ok')).toBe(true)
    expect(isSlackResponseUrlAck('{"ok":true}')).toBe(true)
    // Some rejections answer with nothing at all; an empty body is not
    // evidence of failure, so it stays permissive.
    expect(isSlackResponseUrlAck('')).toBe(true)
  })

  test('rejects the error tokens Slack returns with HTTP 200', () => {
    expect(isSlackResponseUrlAck('invalid_blocks')).toBe(false)
    expect(isSlackResponseUrlAck('action_prohibited')).toBe(false)
    expect(isSlackResponseUrlAck('{"ok":false,"error":"expired_url"}')).toBe(false)
  })

  test('treats an unparseable JSON-looking body as a failure', () => {
    expect(isSlackResponseUrlAck('{not json')).toBe(false)
  })
})
