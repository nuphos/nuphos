import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import {
  assertTailnetTag,
  renderTailnetAclSnippet,
  requireTailnetSandboxTag,
  tailnetSandboxHostname,
} from './tailnet-access'

describe('assertTailnetTag', () => {
  test('accepts the tag grammar Tailscale and the dialer share', () => {
    expect(assertTailnetTag('tag:nuphos')).toBe('tag:nuphos')
    expect(assertTailnetTag('tag:nuphos-agent-1')).toBe('tag:nuphos-agent-1')
  })

  test('rejects anything that is not a tag', () => {
    for (const bad of ['nuphos', 'tag:', 'tag:-lead', 'tag:UPPER', 'tag:has space', 'group:sre']) {
      expect(() => assertTailnetTag(bad)).toThrow(AppError)
    }
  })
})

describe('requireTailnetSandboxTag', () => {
  const enabledBy = new ObjectId()
  const enabledAt = new Date()

  test('returns the tag once an admin has opted the binding in', () => {
    expect(
      requireTailnetSandboxTag({ enabled: true, tag: 'tag:nuphos', enabledBy, enabledAt }),
    ).toBe('tag:nuphos')
  })

  // A binding that predates the data plane must never gain it implicitly.
  test('refuses when the binding was never opted in', () => {
    expect(() => requireTailnetSandboxTag(undefined)).toThrow(AppError)
  })

  test('refuses when access was turned back off', () => {
    expect(() =>
      requireTailnetSandboxTag({ enabled: false, tag: 'tag:nuphos', enabledBy, enabledAt }),
    ).toThrow(AppError)
  })

  test('refuses a stored tag that no longer parses', () => {
    expect(() =>
      requireTailnetSandboxTag({ enabled: true, tag: 'not-a-tag', enabledBy, enabledAt }),
    ).toThrow(AppError)
  })
})

describe('tailnetSandboxHostname', () => {
  const teamId = new ObjectId('507f1f77bcf86cd799439011')

  test('is a DNS label carrying the session, so tailnet audit rows map back', () => {
    const hostname = tailnetSandboxHostname(teamId, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')

    expect(hostname).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/)
    expect(hostname).toContain('439011')
    expect(hostname).toContain('34567890')
  })

  test('survives a session id with nothing reusable in it', () => {
    expect(tailnetSandboxHostname(teamId, '---')).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/)
  })
})

describe('renderTailnetAclSnippet', () => {
  test('emits the three blocks the customer has to apply', () => {
    const snippet = renderTailnetAclSnippet({
      tag: 'tag:nuphos',
      targetTag: 'tag:staging',
      sshUsers: ['deploy'],
    })

    expect(snippet).toContain('"tagOwners"')
    expect(snippet).toContain('"grants"')
    expect(snippet).toContain('"ip": ["tcp:22"]')
    expect(snippet).toContain('"deploy"')
  })

  // Verified against the live Tailscale API: a "check" rule whose src is a tag
  // is rejected with `"check" action does not support tags in src`, so emitting
  // one would hand the customer a policy file they cannot save.
  test('never emits a check action, which Tailscale rejects for tagged src', () => {
    const snippet = renderTailnetAclSnippet({
      tag: 'tag:nuphos',
      targetTag: 'tag:staging',
      sshUsers: [],
    })

    expect(snippet).toContain('"action": "accept"')
    expect(snippet).not.toContain('"action": "check"')
    expect(snippet).not.toContain('checkPeriod')
  })

  test('enforces recording when the customer runs a recorder', () => {
    const snippet = renderTailnetAclSnippet({
      tag: 'tag:nuphos',
      targetTag: 'tag:staging',
      sshUsers: ['deploy'],
      recorderTag: 'tag:tsrecorder',
    })

    expect(snippet).toContain('"recorder": ["tag:tsrecorder"]')
    expect(snippet).toContain('"enforceRecorder": true')
  })

  test('omits the recording clause when there is no recorder', () => {
    const snippet = renderTailnetAclSnippet({
      tag: 'tag:nuphos',
      targetTag: 'tag:staging',
      sshUsers: [],
    })

    expect(snippet).not.toContain('enforceRecorder')
  })

  test('validates both tags rather than interpolating them blindly', () => {
    expect(() =>
      renderTailnetAclSnippet({ tag: 'tag:nuphos', targetTag: '"; evil', sshUsers: [] }),
    ).toThrow(AppError)
  })
})
