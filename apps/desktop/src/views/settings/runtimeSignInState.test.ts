import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeStatusView } from './runtimePresentation.ts'

import type { RuntimeInstance } from '../../types/runtime.ts'
import type { OpenAbRuntimeStatus } from '../../types/team.ts'

const external = {
  id: 'r1',
  provider: 'codex',
  kind: 'external',
  status: 'active',
  label: 'Self-hosted Codex',
  createdAt: '',
} as RuntimeInstance

const online = {
  configured: true,
  selected: true,
  connected: true,
  online: true,
  attachedConversations: 0,
  busyConversations: 0,
} as OpenAbRuntimeStatus

test('a self-hosted runtime that says it holds no account asks for sign-in up front', () => {
  assert.deepEqual(runtimeStatusView(external, { ...online, authenticated: false }, false), {
    label: 'Sign in required',
    tone: 'pending',
  })
})

test('a runtime that cannot answer is never reported as signed out', () => {
  // An older image, or a runtime whose operator set a token on it, arrives here without
  // the field. Treating that as "signed out" would mark
  // every runtime that works today as broken.
  assert.deepEqual(runtimeStatusView(external, online, false), {
    label: 'Online',
    tone: 'online',
  })
  assert.deepEqual(runtimeStatusView(external, { ...online, authenticated: true }, false), {
    label: 'Online',
    tone: 'online',
  })
})

test('a disabled runtime says so rather than asking for a sign-in it cannot run', () => {
  assert.deepEqual(
    runtimeStatusView(
      { ...external, status: 'disabled' },
      { ...online, authenticated: false },
      false,
    ),
    { label: 'Disabled', tone: 'off' },
  )
})

test('a managed agent that does not answer yet is starting; a self-hosted one is unreachable', () => {
  const silent = { ...online, online: false }

  assert.deepEqual(runtimeStatusView({ ...external, kind: 'managed' }, silent, false), {
    label: 'Starting…',
    tone: 'pending',
  })
  assert.deepEqual(runtimeStatusView(external, silent, false), {
    label: 'Unreachable',
    tone: 'error',
  })
})
