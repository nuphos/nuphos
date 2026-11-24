import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { selectAgentK8sBindings } from './bindings'

import type { OnpremClusterBinding } from '@/models'

const cluster = (allow: string[]) =>
  ({ id: new ObjectId(), access: { memberAllowList: allow } }) as unknown as OnpremClusterBinding

const ids = (list: OnpremClusterBinding[]) => list.map((binding) => binding.id.toHexString())

describe('selectAgentK8sBindings', () => {
  const before = cluster(['*'])
  const later = cluster(['*'])
  const ownerOnly = cluster(['owner'])
  const bindings = { onpremClusters: [before, later, ownerOnly] }

  test('a stored list reaches only the clusters it names', () => {
    const selected = { onpremClusterIds: ids([before]) }

    expect(
      ids(selectAgentK8sBindings({ bindings, selected, principals: ['owner'] }).onprem),
    ).toEqual(ids([before]))
  })

  test('All reaches clusters added after it was saved', () => {
    const selected = { allCredentials: true, onpremClusterIds: ids([before]) }

    expect(
      ids(selectAgentK8sBindings({ bindings, selected, principals: ['owner'] }).onprem),
    ).toEqual(ids([before, later, ownerOnly]))
  })

  test('All still needs every principal to be allowed, so a teammate gets no more', () => {
    const selected = { allCredentials: true }

    expect(
      ids(selectAgentK8sBindings({ bindings, selected, principals: ['mate', 'owner'] }).onprem),
    ).toEqual(ids([before, later]))
  })
})
