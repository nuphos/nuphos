import { describe, expect, test } from 'bun:test'

import { scopeAgentK8sBindings } from './session'

import type { AgentK8sBindings } from './bindings'

const opaqueBinding = { id: { toHexString: () => 'id' } }

function bindings(): AgentK8sBindings {
  return {
    aws: [opaqueBinding] as AgentK8sBindings['aws'],
    gcp: [opaqueBinding] as AgentK8sBindings['gcp'],
    tencent: [opaqueBinding] as AgentK8sBindings['tencent'],
    aliyun: [opaqueBinding] as AgentK8sBindings['aliyun'],
    linode: [opaqueBinding] as AgentK8sBindings['linode'],
    volcengine: [opaqueBinding] as AgentK8sBindings['volcengine'],
    azure: [opaqueBinding] as AgentK8sBindings['azure'],
    onprem: [opaqueBinding] as AgentK8sBindings['onprem'],
  }
}

describe('scopeAgentK8sBindings', () => {
  test('keeps only already-enrolled on-prem bindings for the fast bootstrap', () => {
    const result = scopeAgentK8sBindings(bindings(), 'onprem')

    expect(result.onprem).toHaveLength(1)
    expect(
      Object.entries(result)
        .filter(([provider]) => provider !== 'onprem')
        .every(([, values]) => values.length === 0),
    ).toBe(true)
  })

  test('leaves every provider available for the eventual complete sync', () => {
    const original = bindings()

    expect(scopeAgentK8sBindings(original, 'all')).toBe(original)
  })
})
