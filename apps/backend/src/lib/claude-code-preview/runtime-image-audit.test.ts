import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { runtimeImageAuditEvent } from './runtime-image-audit'

const id = new ObjectId('64f1a2b3c4d5e6f7a8b9c0d1')
const ts = '2026-07-11T08:00:00.000Z'
const digest = (tag: string): string => `ghcr.io/zeabur/${tag}@sha256:${'a'.repeat(64)}`

test('an image change row names the actor and both digests', () => {
  const row = runtimeImageAuditEvent({
    _id: id,
    teamId: 'team-1',
    runtimeId: 'runtime-1',
    provider: 'codex',
    runtimeLabel: 'Work',
    actorUserId: 'user-1',
    fromImage: digest('nuphos-runtime'),
    toImage: digest('other'),
    createdAt: new Date(ts),
  })

  expect(row).toEqual({
    kind: 'runtime_image',
    eventId: `runtime_image:${id.toHexString()}`,
    ts,
    type: 'runtime_image_change',
    actor: { userId: 'user-1', teamId: 'team-1' },
    resource: {
      kind: 'runtime',
      runtimeId: 'runtime-1',
      provider: 'codex',
      label: 'Work',
    },
    change: { fromImage: digest('nuphos-runtime'), toImage: digest('other') },
  })
})

test('a runtime that had no image of its own still records the digest it gained', () => {
  const row = runtimeImageAuditEvent({
    teamId: 'team-1',
    runtimeId: 'runtime-1',
    provider: 'claude-code',
    runtimeLabel: 'Work',
    actorUserId: null,
    fromImage: null,
    toImage: digest('nuphos-runtime'),
    createdAt: new Date(ts),
  })

  expect(row.change).toEqual({ fromImage: null, toImage: digest('nuphos-runtime') })
  expect(row.eventId).toBe(`runtime_image:runtime-1:${ts}`)
})
