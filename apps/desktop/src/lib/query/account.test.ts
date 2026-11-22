import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query'

import type { DeviceExecAuditEntry, DeviceExecAuditPage } from '../../api.ts'
import type { PersonalCredential } from '../../types'

const entry = (id: string) => ({ id }) as DeviceExecAuditEntry
let newest = 'a'
let releaseOlder = () => {}
const credentialReads: ((list: PersonalCredential[]) => void)[] = []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      atlasListPersonalCredentials: () =>
        new Promise<PersonalCredential[]>((resolve) => credentialReads.push(resolve)),
      deviceListAudit: (before?: string): Promise<DeviceExecAuditPage> => {
        if (!before) return Promise.resolve({ entries: [entry(newest)], nextCursor: 'c1' })

        return new Promise((resolve) => {
          releaseOlder = () => resolve({ entries: [entry('old')], nextCursor: null })
        })
      },
    },
  },
})
const { createQueryClient } = await import('./client.ts')
const { queryClient } = await import('./client.ts')
const { deviceAuditQuery, personalCredentialsChanged, personalCredentialsQuery } =
  await import('./account.ts')

test('a refresh made while older activity loads does not append that stale page', async () => {
  const client = createQueryClient()
  const observer = new InfiniteQueryObserver(client, deviceAuditQuery)
  const stop = observer.subscribe(() => {})

  try {
    await client.fetchInfiniteQuery(deviceAuditQuery)
    const more = observer.fetchNextPage()

    newest = 'b'
    const refresh = observer.refetch()

    releaseOlder()
    await Promise.all([more, refresh])
    const ids = observer
      .getCurrentResult()
      .data?.pages.flatMap((page) => page.entries.map((e) => e.id))

    assert.deepEqual(ids, ['b'])
  } finally {
    stop()
  }
})

test('a grant claimed while the first read is in flight reads the credentials again', async () => {
  const observer = new QueryObserver(queryClient, personalCredentialsQuery)
  const stop = observer.subscribe(() => {})
  const github = { provider: 'github', login: 'octocat' } as PersonalCredential

  try {
    // The Connectors page opened just before the browser handed the grant back.
    assert.equal(credentialReads.length, 1)
    const changed = personalCredentialsChanged()

    credentialReads[0]([])
    for (let tick = 0; tick < 50 && credentialReads.length < 2; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    assert.equal(credentialReads.length, 2, 'the change reads the credentials again')
    credentialReads[1]([github])
    await changed
    assert.deepEqual(observer.getCurrentResult().data, [github])
  } finally {
    stop()
  }
})
